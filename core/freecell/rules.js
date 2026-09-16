/**
 * foundation配列の並びを固定 (0:H, 1:D, 2:C, 3:S)
 */
export function suitToFoundationIndex(suit) {
    switch (suit) {
        case "H": return 0;
        case "D": return 1;
        case "C": return 2;
        case "S": return 3;
    }
}
/**
 * 列の一番下(末尾)のカードを返す。空ならnull。
 */
export function peekColumnTop(state, colIndex) {
    const col = state.columns[colIndex];
    if (!col || col.length === 0)
        return null;
    return col[col.length - 1];
}
/**
 * foundationの指定インデックスのトップカード
 */
export function peekFoundationTop(state, foundationIndex) {
    const pile = state.foundations[foundationIndex];
    if (!pile || pile.length === 0)
        return null;
    return pile[pile.length - 1];
}
/**
 * foundation(スート山)に次に置けるランクを返す
 * 空なら1(A)
 */
function getNextFoundationRank(state, suit) {
    const fIndex = suitToFoundationIndex(suit);
    const pile = state.foundations[fIndex];
    if (!pile || pile.length === 0)
        return 1;
    const top = pile[pile.length - 1];
    return top.rank + 1;
}
/**
 * foundationにこのカードを置けるか？
 * (スート別に A→K 昇順)
 */
export function canPlaceOnFoundation(state, card) {
    return card.rank === getNextFoundationRank(state, card.suit);
}
/**
 * column(列)の上にこのカードを置けるか？
 * FreeCellルール:
 * - 空列には何でも置ける
 * - 空でない場合、置かれる側(top)と置くカードの色が交互
 *   かつ 置くカードのランクが1小さい
 *   (例: 黒6の上に赤5)
 */
export function canPlaceOnColumnTop(targetTop, movingCard) {
    if (targetTop === null) {
        return true; // 空列なら何でも
    }
    const colorOK = targetTop.color !== movingCard.color;
    const rankOK = movingCard.rank === targetTop.rank - 1;
    return colorOK && rankOK;
}
/**
 * 空フリーセル数
 */
function countEmptyFreecells(state) {
    return state.freecells.reduce((acc, slot) => acc + (slot === null ? 1 : 0), 0);
}
/**
 * 空列数
 */
function countEmptyColumns(state) {
    return state.columns.reduce((acc, col) => acc + (col.length === 0 ? 1 : 0), 0);
}
/**
 * FreeCell標準ルール:
 * 同時に動かせる最大枚数 = (空きフリーセル数 + 1) * 2^(空列数)
 */
export function calcMaxMovableLen(state) {
    const freeAvail = countEmptyFreecells(state);
    const emptyCols = countEmptyColumns(state);
    return (freeAvail + 1) * Math.pow(2, emptyCols);
}
/**
 * 列 colIndex の startIndex から「列の一番下まで」
 * 交互色・ランク降順でちゃんとつながっているスタックを返す。
 *
 * 重要ポイント：
 * - 途中で色交互/ランク降順が崩れたらそこで止める
 * - その結果、列の一番下(末尾)まで届いてなければ「その位置からは動かせない」とみなして [] を返す
 *
 * つまり、
 * 「その位置から下全部まとめて尾っぽまで持ち上げられる塊」
 * だけが返る。
 * 中腹だけ抜くのは禁止になる。
 */
export function getStackFromColumn(state, colIndex, startIndex) {
    const col = state.columns[colIndex];
    if (!col)
        return [];
    if (startIndex < 0 || startIndex >= col.length)
        return [];
    const seq = [col[startIndex]];
    for (let i = startIndex + 1; i < col.length; i++) {
        const prev = seq[seq.length - 1];
        const next = col[i];
        const colorOK = prev.color !== next.color;
        const rankOK = prev.rank === next.rank + 1;
        if (colorOK && rankOK) {
            seq.push(next);
        }
        else {
            break;
        }
    }
    // 列の一番下まで届いていないなら、この位置からは動かせない扱い
    // （=中腹だけ抜くのは禁止）
    if (startIndex + seq.length !== col.length) {
        return [];
    }
    return seq;
}
/**
 * 1手移動のプランを立てる
 *
 * 追加で制限していること：
 * - column → freecell は「列の一番下の1枚だけ」しか許可しない
 *   => startIndex がその列の末尾じゃない場合はNG
 * - column → foundation も同様で、一番下の1枚だけ
 *   => startIndex が末尾でない場合はNG
 *
 * column → column のときは
 * getStackFromColumn() で取った「末尾までつながるスタック」
 * を (空フリーセル数等から計算した最大可動枚数で) 切った束だけOK。
 */
export function planMoveBundle(state, from, to) {
    const maxMovable = calcMaxMovableLen(state);
    // ---- from: column ----
    if (from.type === "column") {
        if (from.index === undefined) {
            return { ok: false, reason: "column indexなし" };
        }
        const colIndex = from.index;
        const col = state.columns[colIndex];
        if (!col || col.length === 0) {
            return { ok: false, reason: "列が空" };
        }
        const startIndex = from.startIndex !== undefined
            ? from.startIndex
            : col.length - 1; // デフォは末尾
        // 列のこの位置から末尾までちゃんと連結してるスタック
        const seqFull = getStackFromColumn(state, colIndex, startIndex);
        if (seqFull.length === 0) {
            return { ok: false, reason: "その位置のスタックは動かせない" };
        }
        // ポイント：スタック全体が maxMovable 以下じゃないとダメ
        // つまり途中だけ千切って動かすのは禁止
        if (seqFull.length > maxMovable) {
            return { ok: false, reason: "スタックが大きすぎる" };
        }
        // ここから先は seqFull 丸ごとを動かす前提
        const cardsToMove = seqFull;
        if (to.type === "column") {
            if (to.index === undefined) {
                return { ok: false, reason: "to column indexなし" };
            }
            const dstCol = state.columns[to.index];
            const dstTop = dstCol && dstCol.length > 0 ? dstCol[dstCol.length - 1] : null;
            const head = cardsToMove[0];
            if (!canPlaceOnColumnTop(dstTop, head)) {
                return { ok: false, reason: "列に置けない" };
            }
            return {
                ok: true,
                cards: cardsToMove,
                fromDetail: {
                    type: "column",
                    colIndex,
                    startIndex
                },
                toDetail: {
                    type: "column",
                    colIndex: to.index
                },
                actionType: cardsToMove.length > 1 ? "MOVE_STACK" : "MOVE_CARD"
            };
        }
        if (to.type === "freecell") {
            if (to.index === undefined) {
                return { ok: false, reason: "to freecell indexなし" };
            }
            // freecellは必ず空で1枚だけ入れられる。
            // かつ列の「一番下の1枚だけ」じゃないとダメ。
            const slot = state.freecells[to.index];
            if (slot !== null) {
                return { ok: false, reason: "freecell埋まってる" };
            }
            const lastIdx = col.length - 1;
            if (startIndex !== lastIdx) {
                return {
                    ok: false,
                    reason: "freecellへは一番下の1枚だけ"
                };
            }
            const one = cardsToMove[0]; // ここは必ず1枚のはず
            return {
                ok: true,
                cards: [one],
                fromDetail: {
                    type: "column",
                    colIndex,
                    startIndex
                },
                toDetail: {
                    type: "freecell",
                    freecellIndex: to.index
                },
                actionType: "MOVE_CARD"
            };
        }
        if (to.type === "foundation") {
            // foundationへは列の一番下の1枚しか送らない
            const lastIdx = col.length - 1;
            if (startIndex !== lastIdx) {
                return {
                    ok: false,
                    reason: "foundationへは一番下の1枚だけ"
                };
            }
            const one = cardsToMove[0]; // ここも1枚想定
            if (!canPlaceOnFoundation(state, one)) {
                return { ok: false, reason: "foundation順NG" };
            }
            const fIdx = suitToFoundationIndex(one.suit);
            return {
                ok: true,
                cards: [one],
                fromDetail: {
                    type: "column",
                    colIndex,
                    startIndex
                },
                toDetail: {
                    type: "foundation",
                    foundationIndex: fIdx
                },
                actionType: "MOVE_TO_FOUNDATION"
            };
        }
        return { ok: false, reason: "to不明" };
    }
    // ---- from: freecell ----
    if (from.type === "freecell") {
        if (from.index === undefined) {
            return { ok: false, reason: "freecell indexなし" };
        }
        const fidx = from.index;
        const card = state.freecells[fidx];
        if (!card) {
            return { ok: false, reason: "freecell空" };
        }
        if (to.type === "column") {
            if (to.index === undefined) {
                return { ok: false, reason: "to column indexなし" };
            }
            const dstCol = state.columns[to.index];
            const dstTop = dstCol && dstCol.length > 0 ? dstCol[dstCol.length - 1] : null;
            if (!canPlaceOnColumnTop(dstTop, card)) {
                return { ok: false, reason: "列に置けない" };
            }
            return {
                ok: true,
                cards: [card],
                fromDetail: {
                    type: "freecell",
                    freecellIndex: fidx
                },
                toDetail: {
                    type: "column",
                    colIndex: to.index
                },
                actionType: "MOVE_CARD"
            };
        }
        if (to.type === "foundation") {
            if (!canPlaceOnFoundation(state, card)) {
                return { ok: false, reason: "foundation順NG" };
            }
            const fIdx = suitToFoundationIndex(card.suit);
            return {
                ok: true,
                cards: [card],
                fromDetail: {
                    type: "freecell",
                    freecellIndex: fidx
                },
                toDetail: {
                    type: "foundation",
                    foundationIndex: fIdx
                },
                actionType: "MOVE_TO_FOUNDATION"
            };
        }
        if (to.type === "freecell") {
            return { ok: false, reason: "freecell->freecell未対応" };
        }
        return { ok: false, reason: "to不明" };
    }
    // ---- from: foundation ----
    if (from.type === "foundation") {
        if (from.index === undefined) {
            return { ok: false, reason: "foundation indexなし" };
        }
        const fIndex = from.index;
        const pile = state.foundations[fIndex];
        if (!pile || pile.length === 0) {
            return { ok: false, reason: "foundation空" };
        }
        const card = pile[pile.length - 1];
        if (to.type === "column") {
            if (to.index === undefined) {
                return { ok: false, reason: "to column indexなし" };
            }
            const dstCol = state.columns[to.index];
            const dstTop = dstCol && dstCol.length > 0 ? dstCol[dstCol.length - 1] : null;
            if (!canPlaceOnColumnTop(dstTop, card)) {
                return { ok: false, reason: "列に戻せない" };
            }
            return {
                ok: true,
                cards: [card],
                fromDetail: {
                    type: "foundation",
                    foundationIndex: fIndex
                },
                toDetail: {
                    type: "column",
                    colIndex: to.index
                },
                actionType: "MOVE_CARD"
            };
        }
        if (to.type === "freecell") {
            return { ok: false, reason: "foundation->freecell未対応" };
        }
        if (to.type === "foundation") {
            return { ok: false, reason: "foundation->foundation無意味" };
        }
        return { ok: false, reason: "to不明" };
    }
    return { ok: false, reason: "from不明" };
}
