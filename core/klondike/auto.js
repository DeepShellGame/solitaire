// core/klondike/auto.ts
import { suitToFoundationIndexK, canPlaceOnFoundation_K } from "./rules.js";
/**
 * faceUpが型に無いので any で見る
 */
function isFaceUp(card) {
    return !!card.faceUp;
}
/**
 * ディープコピー
 */
function cloneKState(src) {
    return {
        stock: src.stock.slice(),
        waste: src.waste.slice(),
        foundations: src.foundations.map(p => p.slice()),
        tableaus: src.tableaus.map(col => col.slice()),
        drawCount: src.drawCount, // ★ 必須プロパティもコピー
    };
}
/**
 * tableau(正しくは tableaus) のどこかに裏カードが残ってるなら
 * FINISH確定とは言えない
 */
function anyFaceDownOnTableaus(st) {
    for (const col of st.tableaus) {
        for (const c of col) {
            if (!isFaceUp(c))
                return true;
        }
    }
    return false;
}
/**
 * foundationに安全に積めるか？
 * クロンダイクはそこまで複雑に安全判定しない。
 * ルール上置けるならOK扱い。
 *
 * canPlaceOnFoundation_K は boolean を返すので、
 * ここで { ok, index } 形式にラップする。
 */
function canAutoPlayToFoundation(st, card) {
    const ok = canPlaceOnFoundation_K(st, card);
    if (!ok) {
        return { ok: false, index: -1 };
    }
    const index = suitToFoundationIndexK(card.suit);
    return { ok: true, index };
}
/**
 * 自動で1ステップだけfoundationへ吸い上げる。
 * 優先順位:
 *   wasteトップ → foundation
 *   各tableau列の末尾 → foundation
 *
 * 成功したらtrue、何も動かせなければfalse
 */
export function autoSweepSafeStepKlondike(state) {
    // wasteトップ
    if (state.waste.length > 0) {
        const card = state.waste[state.waste.length - 1];
        if (isFaceUp(card)) {
            const chk = canAutoPlayToFoundation(state, card);
            if (chk.ok) {
                state.waste.pop();
                state.foundations[chk.index].push(card);
                return true;
            }
        }
    }
    // tableau末尾
    for (let ci = 0; ci < state.tableaus.length; ci++) {
        const col = state.tableaus[ci];
        if (!col.length)
            continue;
        const tail = col[col.length - 1];
        if (!isFaceUp(tail))
            continue;
        const chk = canAutoPlayToFoundation(state, tail);
        if (chk.ok) {
            col.pop();
            state.foundations[chk.index].push(tail);
            return true;
        }
    }
    return false;
}
/**
 * FINISHボタンを出していいか？
 *
 * 条件の大枠:
 * - tableaus の中に裏カードが残ってない
 * - シミュレーションで自動吸い上げ(autoSweepSafeStepKlondike)を
 *   止まるまで回すと、wasteとtableausが空になる
 *
 * つまり「もうあとはfoundationに積むだけで終わる」状態。
 */
export function canClearByFoundationOnlyKlondike(orig) {
    if (anyFaceDownOnTableaus(orig))
        return false;
    const sim = cloneKState(orig);
    while (true) {
        const moved = autoSweepSafeStepKlondike(sim);
        if (!moved)
            break;
    }
    const tableausEmpty = sim.tableaus.every((col) => col.length === 0);
    const wasteEmpty = sim.waste.length === 0;
    return tableausEmpty && wasteEmpty;
}
/**
 * 最終クリア判定
 * foundation合計52枚（=4スート×13）が揃ってるか
 */
export function isFullyClearedKlondike(st) {
    let total = 0;
    for (let i = 0; i < st.foundations.length; i++) {
        total += st.foundations[i].length;
    }
    return total === 52;
}
