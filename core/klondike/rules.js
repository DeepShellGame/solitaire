// core/klondike/rules.ts
// スート→foundation配列index
// FreeCellと合わせて [H=0, D=1, C=2, S=3] で固定
export function suitToFoundationIndexK(suit) {
    switch (suit) {
        case "H": return 0;
        case "D": return 1;
        case "C": return 2;
        case "S": return 3;
    }
}
// カード色（赤/黒）
function cardColor(card) {
    return (card.suit === "H" || card.suit === "D") ? "red" : "black";
}
// ディープコピー
function cloneState(st) {
    return {
        stock: st.stock.map(c => ({ ...c })),
        waste: st.waste.map(c => ({ ...c })),
        foundations: st.foundations.map(pile => pile.map(c => ({ ...c }))),
        tableaus: st.tableaus.map(col => col.map(c => ({ ...c }))),
        drawCount: st.drawCount
    };
}
// tableau内部がちゃんと交互色・降順になってるかチェック
// (cardIndex以降がすべて表向きで、rankが1ずつ下がり、色が交互)
function isValidMovableTail(col, cardIndex) {
    for (let i = cardIndex; i < col.length; i++) {
        if (!col[i].faceUp)
            return false;
    }
    for (let i = cardIndex; i < col.length - 1; i++) {
        const a = col[i];
        const b = col[i + 1];
        if (!a.faceUp || !b.faceUp)
            return false;
        if (a.rank !== b.rank + 1)
            return false;
        if (cardColor(a) === cardColor(b))
            return false;
    }
    return true;
}
// tableauから cardIndex 以降を「まとめて動かせる束」として取り出す
export function getMovableStackFromTableau(state, colIndex, cardIndex) {
    const col = state.tableaus[colIndex];
    if (!col)
        return [];
    if (cardIndex < 0 || cardIndex >= col.length)
        return [];
    if (!isValidMovableTail(col, cardIndex))
        return [];
    return col.slice(cardIndex);
}
// tableaus[colIndex] の末尾カードを1枚だけ foundation に置けるか
function canMoveCardToFoundation(card, pile) {
    if (!pile.length) {
        // 空foundationには A しか乗らない
        return card.rank === 1;
    }
    const top = pile[pile.length - 1];
    return (card.suit === top.suit) && (card.rank === top.rank + 1);
}
// tableau の先頭になるカード stackFirst を destCol に置けるか
// 空列には K しか置けない
function canPlaceOnTableauTop(stackFirst, destCol) {
    if (!destCol.length) {
        return stackFirst.rank === 13; // K限定
    }
    const top = destCol[destCol.length - 1];
    if (!top.faceUp)
        return false;
    if (cardColor(stackFirst) === cardColor(top))
        return false;
    // 置くカードは top.rank - 1
    return stackFirst.rank === top.rank - 1;
}
// -------------------------------------------------
// 山札クリック時
// - stock から drawCount 枚めくって waste に表で積む
// - stock が空のときは waste を全部裏に戻して stock に再セット
// -------------------------------------------------
export function drawFromStockKlondike(state) {
    const ns = cloneState(state);
    if (ns.stock.length > 0) {
        // 通常ドロー
        const n = Math.min(ns.drawCount, ns.stock.length);
        for (let i = 0; i < n; i++) {
            const card = ns.stock.pop();
            card.faceUp = true;
            ns.waste.push(card);
        }
        return ns;
    }
    // stock が空 → waste を全部裏に戻してstockへ戻す（無限リサイクル）
    if (ns.waste.length > 0) {
        while (ns.waste.length > 0) {
            const card = ns.waste.pop();
            card.faceUp = false;
            ns.stock.push(card);
        }
    }
    return ns;
}
// クリア判定： foundation が全部13枚積まれているか
function isCleared(ns) {
    for (let i = 0; i < ns.foundations.length; i++) {
        if (ns.foundations[i].length !== 13)
            return false;
    }
    return true;
}
// -------------------------------------------------
// 1手の移動をまとめて適用
// fromRef → destRef
// -------------------------------------------------
export function applyMoveBundleKlondike(state, fromRef, destRef, _turnIndex) {
    const ns = cloneState(state);
    // まず移動対象カード束を取り出す
    let movingCards = [];
    if (fromRef.type === "waste") {
        if (!ns.waste.length) {
            return { ok: false, reason: "wasteが空" };
        }
        const top = ns.waste[ns.waste.length - 1];
        if (!top.faceUp) {
            return { ok: false, reason: "wasteが裏" };
        }
        movingCards = [top];
    }
    else if (fromRef.type === "foundation") {
        const pile = ns.foundations[fromRef.foundationIndex];
        if (!pile.length) {
            return { ok: false, reason: "foundationが空" };
        }
        // foundation→tableauには1枚だけ戻すことを許す
        const top = pile[pile.length - 1];
        movingCards = [top];
    }
    else {
        // tableau
        const col = ns.tableaus[fromRef.colIndex];
        if (!col)
            return { ok: false, reason: "bad tableau col" };
        if (fromRef.cardIndex < 0 || fromRef.cardIndex >= col.length) {
            return { ok: false, reason: "bad cardIndex" };
        }
        // まとめて持てる束の確認
        const stack = getMovableStackFromTableau(ns, fromRef.colIndex, fromRef.cardIndex);
        if (!stack.length) {
            return { ok: false, reason: "その位置からは動かせない" };
        }
        movingCards = stack;
    }
    // -------------------------------------------------
    // 行き先が foundation
    // -------------------------------------------------
    if (destRef.type === "foundation") {
        const fIdx = destRef.foundationIndex;
        if (movingCards.length !== 1) {
            return { ok: false, reason: "foundationへは1枚のみ" };
        }
        const card = movingCards[0];
        const fPile = ns.foundations[fIdx];
        if (!canMoveCardToFoundation(card, fPile)) {
            return { ok: false, reason: "foundationに置けない" };
        }
        // 元からカードを外す
        if (fromRef.type === "waste") {
            ns.waste.pop();
        }
        else if (fromRef.type === "foundation") {
            // foundation→foundation は許さない
            return { ok: false, reason: "foundation同士は不可" };
        }
        else {
            // tableauの場合
            ns.tableaus[fromRef.colIndex] = ns.tableaus[fromRef.colIndex].slice(0, fromRef.cardIndex);
            // めくる
            const leftCol = ns.tableaus[fromRef.colIndex];
            if (leftCol.length > 0) {
                leftCol[leftCol.length - 1].faceUp = true;
            }
        }
        fPile.push(card);
        return {
            ok: true,
            newState: ns,
            logEntry: { type: "move-to-foundation", card },
            cleared: isCleared(ns)
        };
    }
    // -------------------------------------------------
    // 行き先が tableau
    // -------------------------------------------------
    if (destRef.type === "tableau") {
        const dstCol = ns.tableaus[destRef.colIndex];
        if (!dstCol) {
            return { ok: false, reason: "bad dst tableau" };
        }
        const firstMoving = movingCards[0];
        if (!canPlaceOnTableauTop(firstMoving, dstCol)) {
            return { ok: false, reason: "tableauに置けない" };
        }
        // 元から束を削る
        if (fromRef.type === "waste") {
            ns.waste.pop();
        }
        else if (fromRef.type === "foundation") {
            ns.foundations[fromRef.foundationIndex].pop();
        }
        else {
            // tableau→tableau
            ns.tableaus[fromRef.colIndex] = ns.tableaus[fromRef.colIndex].slice(0, fromRef.cardIndex);
            // 残った列の末尾を表向きに
            const leftCol = ns.tableaus[fromRef.colIndex];
            if (leftCol.length > 0) {
                leftCol[leftCol.length - 1].faceUp = true;
            }
        }
        // 置く
        dstCol.push(...movingCards);
        return {
            ok: true,
            newState: ns,
            logEntry: { type: "move-to-tableau", cards: movingCards },
            cleared: isCleared(ns)
        };
    }
    return { ok: false, reason: "unknown dest" };
}
// Klondike のファウンデーションにこのカードを置けるか？
// foundationIndexOverride が渡された場合はそのファウンデーションだけを対象に判定
// 省略時はカードのスートから自動で置き先(♥,♦,♣,♠)を決めます。
export function canPlaceOnFoundation_K(state, card, foundationIndexOverride) {
    // まず置き先の山を決める
    const targetIndex = foundationIndexOverride ?? suitToFoundationIndexK(card.suit);
    const pile = state.foundations[targetIndex];
    if (!pile)
        return false;
    // まだ1枚も置かれていない場合は、そのカードがA(=1)なら置ける
    if (pile.length === 0) {
        return card.rank === 1;
    }
    // すでにカードがある場合は
    // ・同じスートであること
    // ・ランクがちょうど +1 であること
    const top = pile[pile.length - 1];
    // top と同じスートじゃないとダメ
    if (top.suit !== card.suit)
        return false;
    // 例: pileの一番上が 5 なら 次は 6 だけOK
    return card.rank === top.rank + 1;
}
