import { planMoveBundle, suitToFoundationIndex } from "./rules.js";
/**
 * stateをコピー
 */
function cloneState(state) {
    return {
        columns: state.columns.map(col => col.slice()),
        freecells: state.freecells.slice(),
        foundations: state.foundations.map(pile => pile.slice())
    };
}
/**
 * 52枚foundationに乗ればクリア
 */
function checkCleared(ns) {
    const total = (ns.foundations[0]?.length || 0) +
        (ns.foundations[1]?.length || 0) +
        (ns.foundations[2]?.length || 0) +
        (ns.foundations[3]?.length || 0);
    return total === 52;
}
/**
 * 1手を実行する
 * 複数枚スタック移動 / freecell / foundation戻し対応
 */
export function applyMoveBundle(state, from, to, turnIndex) {
    const plan = planMoveBundle(state, from, to);
    if (!plan.ok ||
        !plan.cards ||
        !plan.fromDetail ||
        !plan.toDetail ||
        !plan.actionType) {
        return {
            ok: false,
            reason: plan.reason || "移動不可",
            newState: state
        };
    }
    const cardsToMove = plan.cards;
    const ns = cloneState(state);
    // 1. from から束を抜く
    if (plan.fromDetail.type === "column") {
        const colIndex = plan.fromDetail.colIndex;
        const startIndex = plan.fromDetail.startIndex;
        ns.columns[colIndex].splice(startIndex, cardsToMove.length);
    }
    else if (plan.fromDetail.type === "freecell") {
        const fi = plan.fromDetail.freecellIndex;
        ns.freecells[fi] = null;
    }
    else if (plan.fromDetail.type === "foundation") {
        const fI = plan.fromDetail.foundationIndex;
        ns.foundations[fI].pop();
    }
    else {
        return {
            ok: false,
            reason: "fromDetail.type不明",
            newState: state
        };
    }
    // 2. to へ束を置く
    if (plan.toDetail.type === "column") {
        const dstIndex = plan.toDetail.colIndex;
        const dst = ns.columns[dstIndex];
        for (const c of cardsToMove) {
            dst.push(c);
        }
    }
    else if (plan.toDetail.type === "freecell") {
        const fi = plan.toDetail.freecellIndex;
        if (ns.freecells[fi] !== null) {
            return {
                ok: false,
                reason: "freecell競合",
                newState: state
            };
        }
        ns.freecells[fi] = cardsToMove[0];
    }
    else if (plan.toDetail.type === "foundation") {
        const c0 = cardsToMove[0];
        const fIdx = suitToFoundationIndex(c0.suit);
        ns.foundations[fIdx].push(c0);
    }
    else {
        return {
            ok: false,
            reason: "toDetail.type不明",
            newState: state
        };
    }
    // 3. ログ
    const logEntry = {
        index: turnIndex,
        action: plan.actionType,
        from: {
            type: plan.fromDetail.type,
            colIndex: plan.fromDetail.colIndex,
            startIndex: plan.fromDetail.startIndex,
            freecellIndex: plan.fromDetail.freecellIndex,
            foundationIndex: plan.fromDetail.foundationIndex
        },
        to: {
            type: plan.toDetail.type,
            colIndex: plan.toDetail.colIndex,
            freecellIndex: plan.toDetail.freecellIndex,
            foundationIndex: plan.toDetail.foundationIndex
        },
        cards: cardsToMove.map(c => c.id)
    };
    // 4. クリア判定
    const cleared = checkCleared(ns);
    return {
        ok: true,
        newState: ns,
        logEntry,
        cleared
    };
}
