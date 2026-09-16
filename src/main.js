// src/main.ts
import { ZoomControls } from "./ui/zoomControls.js"; // ★ズームUI
import { createDnD, findDropElementAtPoint, buildStackGhostFromClickedCard } from "./ui/dndCore.js"; // ★D&D共通コア
import { GameSession } from "../shared/session.js";
// ===== FreeCell側 =====
import { applyMoveBundle as applyMoveBundleFreecell, } from "../core/freecell/applyMove.js";
import { calcMaxMovableLen, getStackFromColumn, canPlaceOnFoundation as canPlaceOnFoundationFC, suitToFoundationIndex as suitToFoundationIndexFC } from "../core/freecell/rules.js";
import { renderGameScreen, } from "./ui/renderGameScreen.js";
// ===== Klondike側 =====
import { applyMoveBundleKlondike, // ← 修正
getMovableStackFromTableau } from "../core/klondike/rules.js";
import { renderKlondikeScreen } from "./ui/renderKlondikeScreen.js";
// ===== Spider側 =====
import { renderSpiderScreen, } from "./ui/renderSpiderScreen.js";
// ===== メニュー =====
import { renderMenuScreen } from "./ui/renderMenuScreen.js";
import { enqueueClearedSeed, exportClearedSeedBackupText, importClearedSeedBackupText, } from "./services/clearSeedStore.js";
import { fetchGuaranteedSeed, flushPendingClearedSeeds, pendingClearSeedCount, } from "./services/clearSeedApi.js";
import { loadClearGuaranteeEnabled, saveClearGuaranteeEnabled, } from "./services/clearGuaranteeSetting.js";
import { getDealVersion } from "../shared/dealVersion.js";
// -------------------------------------------------
// デバッグユーティリティ
// -------------------------------------------------
const DEBUG = true;
const t0 = performance.now();
const ts = () => (performance.now() - t0).toFixed(1);
const log = (...args) => { if (DEBUG)
    console.log(...args); };
// -------------------------------------------------
// 画面・セッション
// -------------------------------------------------
let screen = "menu";
let pendingMode = undefined;
let session = null;
let clearGuaranteeEnabled = loadClearGuaranteeEnabled();
let menuNetworkStatus = "";
let startBusy = false;
let seedSyncInFlight = false;
let currentSeedSource = "random";
let uiState = {
    selectedFrom: undefined,
    statusText: "",
    cleared: false,
    showNewGameMenu: false,
};
// FINISH中（freecell/klondike用）※spiderは使わない
let finishing = false;
let finishTimer = null;
// -------------------------------------------------
// 見た目用ユーティリティ
// -------------------------------------------------
function rankToLabel(rank) {
    if (rank === 1)
        return "A";
    if (rank === 11)
        return "J";
    if (rank === 12)
        return "Q";
    if (rank === 13)
        return "K";
    return String(rank);
}
function suitGlyph(suit) {
    switch (suit) {
        case "H": return "♥";
        case "D": return "♦";
        case "C": return "♣";
        case "S": return "♠";
    }
    return "";
}
function getColorBySuit(s) {
    return s === "H" || s === "D" ? "red" : "black";
}
// 共通：カード表記（スート→ランク）
function cardLabelGeneric(card) {
    if (!card)
        return "";
    return `${suitGlyph(card.suit)}${rankToLabel(card.rank)}`;
}
// ===== 選択中カード取得（表示用） =====
function getSelectedHeadCardFreecell(st, src) {
    if (src.srcType === "column") {
        const col = st.columns[src.colIndex];
        if (!col?.length)
            return null;
        return col[src.startIndex];
    }
    else if (src.srcType === "freecell") {
        return st.freecells[src.freecellIndex] || null;
    }
    else {
        const pile = st.foundations[src.foundationIndex];
        if (!pile?.length)
            return null;
        return pile[pile.length - 1];
    }
}
function getSelectedHeadCardKlondike(st, src) {
    if (src.srcType === "tableau") {
        const col = st.tableaus[src.colIndex];
        if (!col?.length)
            return null;
        return col[src.cardIndex];
    }
    else if (src.srcType === "waste") {
        const w = st.waste;
        return w?.length ? w[w.length - 1] : null;
    }
    else {
        const f = st.foundations[src.foundationIndex];
        return f?.length ? f[f.length - 1] : null;
    }
}
function getSelectedHeadCardSpider(st, src) {
    if (src.srcType !== "tableau")
        return null;
    const col = st.columns[src.colIndex];
    if (!col?.length)
        return null;
    return col[src.cardIndex];
}
// -------------------------------------------------
// FreeCell専用ユーティリティ
// -------------------------------------------------
function cloneStateFC(state) {
    return {
        columns: state.columns.map(col => col.slice()),
        freecells: state.freecells.slice(),
        foundations: state.foundations.map(p => p.slice())
    };
}
function isFullyClearedFreecell(state) {
    let total = 0;
    for (let i = 0; i < state.foundations.length; i++) {
        total += state.foundations[i].length;
    }
    return total === 52;
}
function safeToAutoPlayCard_FC(card, foundations) {
    const heights = {
        H: foundations[0].length,
        D: foundations[1].length,
        C: foundations[2].length,
        S: foundations[3].length
    };
    const r = card.rank;
    if (r <= 2)
        return true; // A,2
    if (card.color === "red") {
        const minBlack = Math.min(heights.S, heights.C);
        return r <= minBlack + 1;
    }
    else {
        const minRed = Math.min(heights.H, heights.D);
        return r <= minRed + 1;
    }
}
function canClearByFoundationOnlyFreecell(state) {
    const sim = cloneStateFC(state);
    while (true) {
        let movedThisLoop = false;
        for (let fi = 0; fi < sim.freecells.length; fi++) {
            const card = sim.freecells[fi];
            if (!card)
                continue;
            if (canPlaceOnFoundationFC(sim, card) &&
                safeToAutoPlayCard_FC(card, sim.foundations)) {
                sim.freecells[fi] = null;
                sim.foundations[suitToFoundationIndexFC(card.suit)].push(card);
                movedThisLoop = true;
                break;
            }
        }
        if (movedThisLoop)
            continue;
        for (let ci = 0; ci < sim.columns.length; ci++) {
            const col = sim.columns[ci];
            if (!col.length)
                continue;
            const card = col[col.length - 1];
            if (canPlaceOnFoundationFC(sim, card) &&
                safeToAutoPlayCard_FC(card, sim.foundations)) {
                col.pop();
                sim.foundations[suitToFoundationIndexFC(card.suit)].push(card);
                movedThisLoop = true;
                break;
            }
        }
        if (!movedThisLoop)
            break;
    }
    return isFullyClearedFreecell(sim);
}
function autoSweepSafeStepFreecell() {
    if (!session)
        return false;
    const st = session.state;
    for (let fi = 0; fi < st.freecells.length; fi++) {
        const card = st.freecells[fi];
        if (!card)
            continue;
        if (canPlaceOnFoundationFC(st, card) &&
            safeToAutoPlayCard_FC(card, st.foundations)) {
            const src = { srcType: "freecell", freecellIndex: fi };
            const ok = tryMoveByRefsFreecell(src, { destType: "foundation" });
            if (ok.ok)
                return true;
        }
    }
    for (let ci = 0; ci < st.columns.length; ci++) {
        const col = st.columns[ci];
        if (!col.length)
            continue;
        const card = col[col.length - 1];
        if (canPlaceOnFoundationFC(st, card) &&
            safeToAutoPlayCard_FC(card, st.foundations)) {
            const src = {
                srcType: "column",
                colIndex: ci,
                startIndex: col.length - 1
            };
            const ok = tryMoveByRefsFreecell(src, { destType: "foundation" });
            if (ok.ok)
                return true;
        }
    }
    return false;
}
function uiFromRefToPileRef_FC(src) {
    if (src.srcType === "column") {
        return {
            type: "column",
            index: src.colIndex,
            startIndex: src.startIndex
        };
    }
    if (src.srcType === "freecell") {
        return {
            type: "freecell",
            index: src.freecellIndex
        };
    }
    return {
        type: "foundation",
        index: src.foundationIndex
    };
}
function uiDestRefToPileRef_FC(dest) {
    if (dest.destType === "column") {
        return { type: "column", index: dest.colIndex };
    }
    if (dest.destType === "freecell") {
        return { type: "freecell", index: dest.freecellIndex };
    }
    return { type: "foundation", index: dest.foundationIndex };
}
function tryMoveByRefsFreecell(src, dest) {
    if (!session)
        return { ok: false, reason: "no session" };
    // ★ 同じ場所へのドロップはキャンセル扱い
    if (src.srcType === "column" &&
        dest.destType === "column" &&
        src.colIndex === dest.colIndex) {
        uiState.selectedFrom = undefined;
        uiState.statusText = "選択解除";
        rerender();
        return { ok: false, reason: "same column" };
    }
    if (src.srcType === "freecell" &&
        dest.destType === "freecell" &&
        src.freecellIndex === dest.freecellIndex) {
        uiState.selectedFrom = undefined;
        uiState.statusText = "選択解除";
        rerender();
        return { ok: false, reason: "same freecell" };
    }
    if (src.srcType === "foundation" &&
        dest.destType === "foundation" &&
        dest.foundationIndex !== undefined &&
        src.foundationIndex === dest.foundationIndex) {
        uiState.selectedFrom = undefined;
        uiState.statusText = "選択解除";
        rerender();
        return { ok: false, reason: "same foundation" };
    }
    const stBefore = session.state;
    const head = getSelectedHeadCardFreecell(stBefore, src);
    const headLabel = cardLabelGeneric(head);
    const fromPile = uiFromRefToPileRef_FC(src);
    const toPile = uiDestRefToPileRef_FC(dest);
    const result = applyMoveBundleFreecell(session.state, fromPile, toPile, session.turnIndex);
    log(`[MOVE ${ts()}] FreeCell ${headLabel ?? ""} -> ${JSON.stringify(dest)} ok=${result.ok}`);
    if (!result.ok) {
        uiState.statusText = "移動不可";
        rerender();
        return { ok: false, reason: result.reason };
    }
    session.snapshot();
    session.state = result.newState;
    session.recordMove(result.logEntry);
    if (result.cleared && !uiState.cleared) {
        cancelFinishingNoMsg();
        uiState.cleared = true;
        uiState.statusText = "クリア！";
        saveClearSeedLocal(session);
        const report = session.buildClearReport(true);
        console.log("CLEAR REPORT:", report);
    }
    else {
        if (!uiState.cleared) {
            uiState.statusText = `${headLabel} 移動`;
        }
    }
    uiState.selectedFrom = undefined;
    rerender();
    return { ok: true };
}
function getMovableSeqForSourceFreecell(state, src) {
    if (src.srcType === "column") {
        const seqFull = getStackFromColumn(state, src.colIndex, src.startIndex);
        if (!seqFull.length)
            return [];
        const maxLen = calcMaxMovableLen(state);
        if (seqFull.length > maxLen)
            return [];
        return seqFull;
    }
    if (src.srcType === "freecell") {
        const c = state.freecells[src.freecellIndex];
        return c ? [c] : [];
    }
    if (src.srcType === "foundation") {
        const pile = state.foundations[src.foundationIndex];
        if (!pile.length)
            return [];
        return [pile[pile.length - 1]];
    }
    return [];
}
// -------------------------------------------------
// Klondike専用ユーティリティ
// -------------------------------------------------
function isFaceUpK(card) {
    return !!card.faceUp;
}
function uiFromRefToPileRef_K(src) {
    if (src.srcType === "tableau") {
        return {
            type: "tableau",
            colIndex: src.colIndex,
            cardIndex: src.cardIndex
        };
    }
    if (src.srcType === "waste") {
        return { type: "waste" };
    }
    return { type: "foundation", foundationIndex: src.foundationIndex };
}
function uiDestRefToPileRef_K(dest) {
    if (dest.destType === "tableau") {
        return { type: "tableau", colIndex: dest.colIndex };
    }
    return {
        type: "foundation",
        foundationIndex: dest.foundationIndex
    };
}
function tryMoveByRefsKlondike(src, dest) {
    if (!session)
        return { ok: false, reason: "no session" };
    // ★ 同じ場所へのドロップはキャンセル扱い
    if (src.srcType === "tableau" &&
        dest.destType === "tableau" &&
        src.colIndex === dest.colIndex) {
        uiState.selectedFrom = undefined;
        uiState.statusText = "選択解除";
        rerender();
        return { ok: false, reason: "same tableau" };
    }
    if (src.srcType === "foundation" &&
        dest.destType === "foundation" &&
        src.foundationIndex === dest.foundationIndex) {
        uiState.selectedFrom = undefined;
        uiState.statusText = "選択解除";
        rerender();
        return { ok: false, reason: "same foundation" };
    }
    const stBefore = session.state;
    const head = getSelectedHeadCardKlondike(stBefore, src);
    const headLabel = cardLabelGeneric(head);
    const result = applyMoveBundleKlondike(session.state, uiFromRefToPileRef_K(src), uiDestRefToPileRef_K(dest), session.turnIndex);
    log(`[MOVE ${ts()}] Klondike ${headLabel ?? ""} -> ${JSON.stringify(dest)} ok=${result.ok}`);
    if (!result.ok || !result.newState) {
        uiState.statusText = "移動不可";
        rerender();
        return { ok: false, reason: result.reason };
    }
    session.snapshot();
    session.state = result.newState;
    if (result.logEntry) {
        session.recordMove(result.logEntry);
    }
    if (result.cleared && !uiState.cleared) {
        cancelFinishingNoMsg();
        uiState.cleared = true;
        uiState.statusText = "クリア！";
        saveClearSeedLocal(session);
        const report = session.buildClearReport(true);
        console.log("CLEAR REPORT:", report);
    }
    else {
        if (!uiState.cleared) {
            uiState.statusText = `${headLabel} 移動`;
        }
    }
    uiState.selectedFrom = undefined;
    rerender();
    return { ok: true };
}
function getMovableSeqForSourceKlondike(state, src) {
    if (src.srcType === "waste") {
        const w = state.waste;
        if (!w.length)
            return [];
        const top = w[w.length - 1];
        if (!isFaceUpK(top))
            return [];
        return [top];
    }
    if (src.srcType === "foundation") {
        const f = state.foundations[src.foundationIndex];
        if (!f.length)
            return [];
        const top = f[f.length - 1];
        return [top];
    }
    return getMovableStackFromTableau(state, src.colIndex, src.cardIndex);
}
function autoToFoundationKlondike(src) {
    if (!session)
        return;
    const st = session.state;
    for (let fIndex = 0; fIndex < st.foundations.length; fIndex++) {
        const result = tryMoveByRefsKlondike(src, {
            destType: "foundation",
            foundationIndex: fIndex,
        });
        if (result.ok) {
            return;
        }
    }
    uiState.statusText = "移動不可";
    rerender();
}
function allTableauFaceUp_K(st) {
    for (let ci = 0; ci < st.tableaus.length; ci++) {
        const col = st.tableaus[ci];
        for (let pi = 0; pi < col.length; pi++) {
            const c = col[pi];
            if (!c.faceUp)
                return false;
        }
    }
    return true;
}
function isFullyClearedKlondike(st) {
    let total = 0;
    for (let i = 0; i < st.foundations.length; i++) {
        total += st.foundations[i].length;
    }
    return total === 52;
}
function isKlondikeReadyForFinishNow(st) {
    const stockEmpty = st.stock.length === 0;
    const wasteEmpty = st.waste.length === 0;
    const noFaceDown = allTableauFaceUp_K(st);
    return stockEmpty && wasteEmpty && noFaceDown;
}
// -------------------------------------------------
// Spider専用ユーティリティ
// -------------------------------------------------
function sameSourceSpider(a, b) {
    return (a.srcType === "tableau" &&
        b.srcType === "tableau" &&
        a.colIndex === b.colIndex &&
        a.cardIndex === b.cardIndex);
}
function getMovableSeqForSourceSpider(state, src) {
    if (!src || src.srcType !== "tableau")
        return [];
    const col = state.columns[src.colIndex];
    if (!col)
        return [];
    const start = src.cardIndex;
    if (start < 0 || start >= col.length)
        return [];
    const first = col[start];
    if (!first.faceUp)
        return [];
    const suit = first.suit;
    let expectedRank = first.rank;
    const seq = [first];
    for (let i = start + 1; i < col.length; i++) {
        const cur = col[i];
        if (!cur.faceUp)
            return [];
        if (cur.suit !== suit)
            return [];
        if (cur.rank !== expectedRank - 1)
            return [];
        seq.push(cur);
        expectedRank = cur.rank;
    }
    return seq;
}
function spiderCanTakeSeq(destCol, seq) {
    if (seq.length === 0)
        return false;
    if (destCol.length === 0)
        return true;
    const destTop = destCol[destCol.length - 1];
    if (!destTop.faceUp)
        return false;
    return seq[0].rank === destTop.rank - 1;
}
function spiderCutSeqFromColumn(col, startIndex) {
    const moved = col.slice(startIndex);
    col.splice(startIndex, moved.length);
    return moved;
}
function spiderFlipTailIfNeeded(col) {
    if (col.length === 0)
        return;
    const tail = col[col.length - 1];
    if (!tail.faceUp) {
        tail.faceUp = true;
    }
}
function tryMoveByRefsSpider(srcRef, destRef) {
    if (!session)
        return { ok: false, reason: "no session" };
    if (session.mode !== "spider")
        return { ok: false, reason: "not spider" };
    const animObj = window.spiderAnim || { active: false, timer: null };
    if (animObj.active) {
        uiState.statusText = "移動不可";
        rerender();
        return { ok: false, reason: "anim" };
    }
    const st = session.state;
    if (!srcRef || srcRef.srcType !== "tableau" ||
        !destRef || destRef.destType !== "tableau") {
        uiState.statusText = "移動不可";
        rerender();
        return { ok: false, reason: "bad ref" };
    }
    const fromColIndex = srcRef.colIndex;
    const fromStartIdx = srcRef.cardIndex;
    const toColIndex = destRef.colIndex;
    if (fromColIndex === toColIndex) {
        uiState.selectedFrom = undefined;
        uiState.statusText = "選択解除";
        rerender();
        return { ok: false, reason: "same column" };
    }
    const fromCol = st.columns[fromColIndex];
    const toCol = st.columns[toColIndex];
    if (!fromCol || !toCol) {
        uiState.statusText = "移動不可";
        rerender();
        return { ok: false, reason: "bad column" };
    }
    const movableSeq = getMovableSeqForSourceSpider(st, {
        srcType: "tableau",
        colIndex: fromColIndex,
        cardIndex: fromStartIdx
    });
    if (!movableSeq.length) {
        uiState.statusText = "動かせない";
        rerender();
        return { ok: false, reason: "no movable seq" };
    }
    if (!spiderCanTakeSeq(toCol, movableSeq)) {
        uiState.statusText = "移動不可";
        rerender();
        return { ok: false, reason: "cant place" };
    }
    const head = fromCol[fromStartIdx];
    const headLabel = cardLabelGeneric(head);
    session.snapshot();
    const movedCards = spiderCutSeqFromColumn(fromCol, fromStartIdx);
    for (let i = 0; i < movedCards.length; i++) {
        toCol.push(movedCards[i]);
    }
    spiderFlipTailIfNeeded(fromCol);
    uiState.selectedFrom = undefined;
    uiState.cleared = false;
    uiState.statusText = `${headLabel} 移動`;
    session.recordMove({
        type: "spiderMove",
        fromColIndex,
        fromStartIdx,
        toColIndex,
        movedLen: movedCards.length
    });
    log(`[MOVE ${ts()}] Spider ${headLabel ?? ""} -> col${toColIndex} len=${movedCards.length} ok=true`);
    rerender();
    spiderAfterMutation();
    return { ok: true };
}
function isFullyClearedSpider(st) {
    const stockEmpty = !st.stock || st.stock.length === 0;
    const colsEmpty = st.columns.every(col => col.length === 0);
    return stockEmpty && colsEmpty;
}
function spiderDealFromStockOnce() {
    if (!session || session.mode !== "spider")
        return;
    const st = session.state;
    const animObj = window.spiderAnim || { active: false, timer: null };
    if (animObj.active) {
        uiState.statusText = "回収中でございます";
        rerender();
        return;
    }
    const anyEmpty = st.columns.some(col => col.length === 0);
    if (anyEmpty) {
        uiState.statusText = "空の列があるので配れません";
        rerender();
        return;
    }
    if (!st.stock || st.stock.length < 10) {
        uiState.statusText = "山札なし";
        rerender();
        return;
    }
    session.snapshot();
    for (let ci = 0; ci < 10; ci++) {
        const c = st.stock.pop();
        if (!c)
            break;
        c.faceUp = true;
        st.columns[ci].push(c);
    }
    uiState.selectedFrom = undefined;
    uiState.cleared = false;
    uiState.statusText = "山札を配りました";
    session.recordMove({ type: "spiderDeal" });
    log(`[SPIDER ${ts()}] deal from stock`);
    rerender();
    spiderAfterMutation();
}
function spiderFindCompleteRun(st) {
    for (let colIndex = 0; colIndex < st.columns.length; colIndex++) {
        const col = st.columns[colIndex];
        if (col.length < 13)
            continue;
        const startIdx = col.length - 13;
        const suit = col[startIdx].suit;
        let ok = true;
        for (let i = 0; i < 13; i++) {
            const c = col[startIdx + i];
            const expectedRank = 13 - i; // K→…→A
            if (!c.faceUp) {
                ok = false;
                break;
            }
            if (c.suit !== suit) {
                ok = false;
                break;
            }
            if (c.rank !== expectedRank) {
                ok = false;
                break;
            }
        }
        if (ok) {
            return { colIndex, startIdx };
        }
    }
    return null;
}
function flashSpiderColumn(colIndex) {
    const el = document.querySelector(`[data-drop="tableau-${colIndex}"]`);
    if (!el)
        return;
    el.classList.add("spider-column-flash");
    setTimeout(() => {
        el.classList.remove("spider-column-flash");
    }, 300);
}
function spiderAfterMutation() {
    if (!session || session.mode !== "spider")
        return;
    const st = session.state;
    const animObj = window.spiderAnim || (window.spiderAnim = {
        active: false,
        timer: null,
    });
    if (animObj.active)
        return;
    const run = spiderFindCompleteRun(st);
    if (!run) {
        if (isFullyClearedSpider(st) && !uiState.cleared) {
            cancelFinishingNoMsg();
            uiState.cleared = true;
            uiState.statusText = "クリア！";
            saveClearSeedLocal(session);
            const report = session.buildClearReport(true);
            console.log("CLEAR REPORT:", report);
            rerender();
        }
        return;
    }
    const { colIndex, startIdx } = run;
    animObj.active = true;
    function finalizeAfterRemoval() {
        if (!session || session.mode !== "spider") {
            animObj.active = false;
        }
        else {
            const stNow = session.state;
            const col = stNow.columns[colIndex];
            spiderFlipTailIfNeeded(col);
            stNow.completedStacks++;
            rerender();
            flashSpiderColumn(colIndex);
            animObj.active = false;
            animObj.timer = null;
            setTimeout(() => {
                spiderAfterMutation();
            }, 100);
        }
    }
    function removeStep() {
        if (!animObj.active) {
            animObj.timer = null;
            return;
        }
        if (!session || session.mode !== "spider") {
            animObj.active = false;
            animObj.timer = null;
            return;
        }
        const stNow = session.state;
        const col = stNow.columns[colIndex];
        if (col.length <= startIdx) {
            animObj.timer = null;
            finalizeAfterRemoval();
            return;
        }
        col.pop();
        rerender();
        animObj.timer = window.setTimeout(removeStep, 50);
    }
    log(`[SPIDER ${ts()}] remove complete run col=${colIndex} start=${startIdx}`);
    removeStep();
}
;
window.spiderAnim = window.spiderAnim || {
    active: false,
    timer: null,
};
;
window.spiderAfterMutation = spiderAfterMutation;
// -------------------------------------------------
// Spider: ハイライトマップ生成
// -------------------------------------------------
function buildSpiderHighlightMap(state, selected) {
    const highlightColumns = {};
    if (!selected || selected.srcType !== "tableau") {
        return { columns: highlightColumns };
    }
    const colIndex = selected.colIndex;
    const seq = getMovableSeqForSourceSpider(state, selected);
    if (!seq.length) {
        return { columns: highlightColumns };
    }
    const startRow = selected.cardIndex;
    const endRow = startRow + seq.length - 1;
    for (let row = startRow; row <= endRow; row++) {
        if (!highlightColumns[colIndex]) {
            highlightColumns[colIndex] = {};
        }
        highlightColumns[colIndex][row] = true;
    }
    return { columns: highlightColumns };
}
// -------------------------------------------------
// dblclick を優先するドラッグ抑止ウィンドウ
// -------------------------------------------------
let suppressDragUntil = 0;
function armDblClickWindow(ms = 350) {
    suppressDragUntil = performance.now() + ms;
    log(`[DBL ${ts()}] arm window +${ms}ms`);
}
function shouldSuppressDrag() {
    return performance.now() < suppressDragUntil;
}
// -------------------------------------------------
// ★ 自前ダブルクリック検出（同一ソース・短時間2クリック）
//   ブラウザdblclickに依存せず foundation 送りを発火
// -------------------------------------------------
const DBLCLICK_MS = 320;
let lastClickSrc = null;
let lastClickTime = 0;
function isSameSourceByMode(a, b) {
    if (!session)
        return false;
    if (!a || !b)
        return false;
    if (session.mode === "freecell")
        return sameSourceFreecell(a, b);
    if (session.mode === "klondike")
        return sameSourceKlondike(a, b);
    if (session.mode === "spider")
        return sameSourceSpider(a, b);
    return false;
}
function tryHandleDoubleClick(srcNow) {
    if (!session)
        return false;
    if (session.mode === "spider")
        return false; // Spiderは対象外
    const now = performance.now();
    if (lastClickSrc && (now - lastClickTime) <= DBLCLICK_MS && isSameSourceByMode(lastClickSrc, srcNow)) {
        log(`[DBL ${ts()}] detected -> autoToFoundation`);
        autoToFoundationGeneric(srcNow);
        lastClickSrc = null;
        lastClickTime = 0;
        return true;
    }
    lastClickSrc = srcNow;
    lastClickTime = now;
    return false;
}
// -------------------------------------------------
// Spider: 列中カードタップ
// -------------------------------------------------
function onSpiderColumnCardTap(colIndex, rowIndex) {
    if (uiState.cleared)
        return;
    if (!session)
        return;
    if (session.mode !== "spider")
        return;
    const st = session.state;
    const col = st.columns[colIndex];
    if (!col || !col.length) {
        uiState.selectedFrom = undefined;
        uiState.statusText = "動かせない";
        rerender();
        return;
    }
    let chosenStart = undefined;
    for (let tryPos = rowIndex; tryPos < col.length; tryPos++) {
        const tryRef = {
            srcType: "tableau",
            colIndex,
            cardIndex: tryPos,
        };
        const seq = getMovableSeqForSourceSpider(st, tryRef);
        if (seq.length > 0) {
            chosenStart = tryPos;
            break;
        }
    }
    if (chosenStart === undefined) {
        uiState.selectedFrom = undefined;
        uiState.statusText = "動かせない";
        rerender();
        return;
    }
    uiState.selectedFrom = {
        srcType: "tableau",
        colIndex,
        cardIndex: chosenStart,
    };
    const head = col[chosenStart];
    uiState.statusText = cardLabelGeneric(head);
    log(`[SEL ${ts()}] Spider select col=${colIndex} row=${chosenStart} head=${uiState.statusText}`);
    // ダブルタップ猶予
    armDblClickWindow();
    rerender();
}
// -------------------------------------------------
// FINISH関連（freecell/klondike）
// -------------------------------------------------
function saveClearSeedLocal(sess) {
    // クリア保証から取得したseedは、既にサーバー登録済みなので再送しない。
    if (currentSeedSource === "guaranteed") {
        log(`[CLEAR-SEED ${ts()}] skip guaranteed mode=${sess.mode} L${sess.level} seed=${sess.seed >>> 0}`);
        return;
    }
    let moves = 0;
    let durMs = 0;
    let dealVersion = sess.dealVersion | 0;
    try {
        const rep = sess.buildClearReport(true);
        moves = typeof rep.moveCount === "number" ? rep.moveCount | 0 : 0;
        durMs = typeof rep.durationMs === "number" ? rep.durationMs | 0 : 0;
        dealVersion = typeof rep.dealVersion === "number" ? rep.dealVersion | 0 : dealVersion;
    }
    catch {
        // レポート取得に失敗しても seed 自体は保存する
    }
    const pendingBefore = pendingClearSeedCount();
    const enqueueResult = enqueueClearedSeed({
        tsMs: Date.now(),
        mode: sess.mode,
        level: sess.level | 0,
        seed: sess.seed >>> 0,
        dealVersion,
        moves,
        durMs,
    });
    log(`[CLEAR-SEED ${ts()}] ${enqueueResult} mode=${sess.mode} L${sess.level} seed=${sess.seed >>> 0} dealV=${dealVersion}`);
    // 過去の移行対象seedが既に端末内にある場合は、勝手に一括送信しない。
    // 旧GitHub Pagesからバックアップを書き出せるようにするため。
    // 端末内が空の状態から新しく追加されたseedだけは、従来どおり自動送信する。
    if (pendingBefore === 0 && enqueueResult === "added") {
        void syncPendingSeeds(false);
    }
}
async function syncPendingSeeds(showStatus) {
    if (seedSyncInFlight)
        return;
    if (pendingClearSeedCount() === 0) {
        if (showStatus && screen === "menu") {
            menuNetworkStatus = "端末内に未送信のクリアseedはありません";
            rerender();
        }
        return;
    }
    seedSyncInFlight = true;
    if (showStatus && screen === "menu") {
        menuNetworkStatus = "クリア済みseedをサーバーへ同期中...";
        rerender();
    }
    try {
        const result = await flushPendingClearedSeeds();
        if (screen === "menu" && (showStatus || result.removed > 0)) {
            menuNetworkStatus = result.removed > 0
                ? `${result.removed}件のクリア済みseedをサーバーへ登録しました`
                : "クリア済みseedは同期済みです";
            rerender();
        }
    }
    catch (err) {
        log(`[CLEAR-SEED ${ts()}] sync failed`, err);
        if (screen === "menu" && showStatus) {
            menuNetworkStatus = "サーバーへ接続できません。未送信seedはPCに保持しています";
            rerender();
        }
    }
    finally {
        seedSyncInFlight = false;
    }
}
function downloadClearSeedBackup() {
    const count = pendingClearSeedCount();
    if (count <= 0) {
        menuNetworkStatus = "書き出すクリアseedがありません";
        rerender();
        return;
    }
    const text = exportClearedSeedBackupText();
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    a.href = url;
    a.download = `solitaire_clear_seeds_${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    menuNetworkStatus = `${count}件のクリアseedを書き出しました。元データは端末内に残っています`;
    rerender();
}
function openClearSeedImportPicker() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.txt,application/json,text/plain";
    input.style.display = "none";
    input.addEventListener("change", async () => {
        const file = input.files?.[0];
        input.remove();
        if (!file)
            return;
        try {
            const text = await file.text();
            const result = importClearedSeedBackupText(text);
            if (result.total === 0) {
                menuNetworkStatus = "読み込めるクリアseedがありませんでした";
            }
            else {
                menuNetworkStatus = `読み込み完了: ${result.added}件追加 / ${result.duplicates}件重複 / ${result.invalid}件無効`;
            }
            rerender();
        }
        catch (err) {
            log(`[CLEAR-SEED ${ts()}] import failed`, err);
            menuNetworkStatus = "クリアseedファイルの読み込みに失敗しました";
            rerender();
        }
    });
    document.body.appendChild(input);
    input.click();
}
function autoSweepSafeStepKlondikeClient() {
    if (!session)
        return false;
    if (session.mode !== "klondike")
        return false;
    const st = session.state;
    for (let ci = 0; ci < st.tableaus.length; ci++) {
        const col = st.tableaus[ci];
        if (!col.length)
            continue;
        const topIdx = col.length - 1;
        const topCard = col[topIdx];
        if (!topCard.faceUp)
            continue;
        const srcRef = {
            srcType: "tableau",
            colIndex: ci,
            cardIndex: topIdx
        };
        for (let fIndex = 0; fIndex < st.foundations.length; fIndex++) {
            const ok = tryMoveByRefsKlondike(srcRef, {
                destType: "foundation",
                foundationIndex: fIndex
            });
            if (ok.ok) {
                return true;
            }
        }
    }
    return false;
}
function startFinishing() {
    if (!session)
        return;
    if (finishing)
        return;
    if (uiState.cleared)
        return;
    if (session.mode === "spider")
        return;
    finishing = true;
    uiState.statusText = "自動回収中…";
    rerender();
    finishTimer = window.setInterval(() => {
        if (!session) {
            cancelFinishingNoMsg();
            return;
        }
        let moved = false;
        if (session.mode === "freecell") {
            moved = autoSweepSafeStepFreecell();
        }
        else if (session.mode === "klondike") {
            moved = autoSweepSafeStepKlondikeClient();
        }
        else {
            moved = false;
        }
        log(`[AUTO ${ts()}] finishing step moved=${moved}`);
        if (!moved) {
            stopFinishing();
        }
        else {
            rerender();
        }
    }, 100);
}
function cancelFinishingNoMsg() {
    if (finishTimer !== null) {
        clearInterval(finishTimer);
        finishTimer = null;
    }
    finishing = false;
}
function stopFinishing() {
    if (finishTimer !== null) {
        clearInterval(finishTimer);
        finishTimer = null;
    }
    const clearedNow = session && isGameClearedNow(session);
    finishing = false;
    if (session) {
        if (clearedNow && !uiState.cleared) {
            uiState.cleared = true;
            uiState.statusText = "クリア！";
            saveClearSeedLocal(session);
            const report = session.buildClearReport(true);
            console.log("CLEAR REPORT:", report);
        }
        else if (!clearedNow) {
            uiState.statusText = "自動回収完了";
        }
    }
    rerender();
}
function isGameClearedNow(sess) {
    if (sess.mode === "freecell") {
        return isFullyClearedFreecell(sess.state);
    }
    else if (sess.mode === "klondike") {
        return isFullyClearedKlondike(sess.state);
    }
    else if (sess.mode === "spider") {
        return isFullyClearedSpider(sess.state);
    }
    return false;
}
function computeReadyForFinish(sess) {
    if (uiState.cleared)
        return false;
    if (finishing)
        return false;
    if (sess.mode === "freecell") {
        return canClearByFoundationOnlyFreecell(sess.state);
    }
    else if (sess.mode === "klondike") {
        const st = sess.state;
        return isKlondikeReadyForFinishNow(st);
    }
    else if (sess.mode === "spider") {
        return false;
    }
    return false;
}
// -------------------------------------------------
// 選択・クリック操作（共通） ※ドラッグは dndCore に委譲
// -------------------------------------------------
function sameSourceFreecell(a, b) {
    if (a.srcType !== b.srcType)
        return false;
    if (a.srcType === "column") {
        return (b.srcType === "column" &&
            a.colIndex === b.colIndex &&
            a.startIndex === b.startIndex);
    }
    if (a.srcType === "freecell") {
        return (b.srcType === "freecell" &&
            a.freecellIndex === b.freecellIndex);
    }
    return (b.srcType === "foundation" &&
        a.foundationIndex === b.foundationIndex);
}
function sameSourceKlondike(a, b) {
    if (a.srcType !== b.srcType)
        return false;
    if (a.srcType === "waste") {
        return b.srcType === "waste";
    }
    if (a.srcType === "foundation") {
        return (b.srcType === "foundation" &&
            a.foundationIndex === b.foundationIndex);
    }
    return (b.srcType === "tableau" &&
        a.colIndex === b.colIndex &&
        a.cardIndex === b.cardIndex);
}
const dragGate = { timer: null, pointerId: null, startX: 0, startY: 0, srcRef: null, active: false };
const HOLD_MS = 180; // 長押しでドラッグ開始（短いクリックはドラッグにしない）
const MOVE_PX = 8; // この距離を超える移動で即ドラッグ開始
function clearDragGate(reason) {
    if (dragGate.timer != null) {
        clearTimeout(dragGate.timer);
        dragGate.timer = null;
    }
    if (dragGate.active) {
        window.removeEventListener("pointermove", onGateMove, true);
        window.removeEventListener("pointerup", onGateUp, true);
        window.removeEventListener("pointercancel", onGateCancel, true);
        window.removeEventListener("dblclick", onGateDblClick, true);
        dragGate.active = false;
    }
    dragGate.pointerId = null;
    dragGate.srcRef = null;
    log(`[DND ${ts()}] gate cleared (${reason})`);
}
function startDragNow(ev) {
    if (!dragGate.srcRef)
        return;
    log(`[DND ${ts()}] startDrag NOW pid=${dragGate.pointerId} x=${ev.clientX} y=${ev.clientY}`);
    dnd.startDrag(dragGate.srcRef, ev);
    clearDragGate("started");
}
function onGateMove(ev) {
    if (ev.pointerId !== dragGate.pointerId)
        return;
    const dx = Math.abs(ev.clientX - dragGate.startX);
    const dy = Math.abs(ev.clientY - dragGate.startY);
    if (dx >= MOVE_PX || dy >= MOVE_PX) {
        log(`[DND ${ts()}] move threshold hit dx=${dx} dy=${dy} -> start`);
        startDragNow(ev);
    }
}
function onGateUp(ev) {
    if (ev.pointerId !== dragGate.pointerId)
        return;
    log(`[DND ${ts()}] pointerup before hold -> cancel drag (click intent)`);
    clearDragGate("pointerup");
}
function onGateCancel(ev) {
    if (ev.pointerId !== dragGate.pointerId)
        return;
    log(`[DND ${ts()}] pointercancel -> cancel gate`);
    clearDragGate("cancel");
}
function onGateDblClick(_ev) {
    log(`[DBL ${ts()}] dblclick observed -> cancel drag`);
    clearDragGate("dblclick");
}
/** クリック優先のホールド＆距離ゲート入口 */
function startDragWithHoldAndDistanceGate(srcRef, ev) {
    if (uiState.cleared)
        return;
    // 直近 dblclick 猶予中はドラッグを抑止（クリック／自動送り優先）
    if (shouldSuppressDrag()) {
        log(`[DBL ${ts()}] suppress drag within dbl-window`);
        return;
    }
    // 既存ゲートがあれば掃除
    clearDragGate("new-request");
    dragGate.pointerId = ev.pointerId ?? null;
    dragGate.startX = ev.clientX;
    dragGate.startY = ev.clientY;
    dragGate.srcRef = srcRef;
    dragGate.active = true;
    // 監視を開始
    window.addEventListener("pointermove", onGateMove, true);
    window.addEventListener("pointerup", onGateUp, true);
    window.addEventListener("pointercancel", onGateCancel, true);
    window.addEventListener("dblclick", onGateDblClick, true);
    // 一定時間押しっぱなしでドラッグ開始（すぐ離した場合＝クリックは開始しない）
    dragGate.timer = window.setTimeout(() => {
        log(`[DND ${ts()}] hold ${HOLD_MS}ms reached -> start`);
        if (dragGate.active && dragGate.srcRef)
            startDragNow(ev);
    }, HOLD_MS);
    // 選択情報だけ更新する。pointerdown中のDOMを再描画しないことで、直接ドラッグとdblclickを維持する。
    updateSelectionAndStatusForDragStart(srcRef);
    log(`[DND ${ts()}] gate armed pid=${dragGate.pointerId} at(${dragGate.startX},${dragGate.startY}) hold=${HOLD_MS} move=${MOVE_PX}`);
}
// 互換：既存呼び出し点の関数名は維持
function startDragWithDblclickGuard(srcRef, ev) {
    startDragWithHoldAndDistanceGate(srcRef, ev);
}
// -------------------------------------------------
// ドラッグ開始時に選択状態と状況テキストを更新
// -------------------------------------------------
function updateSelectionAndStatusForDragStart(src) {
    if (!session)
        return;
    uiState.selectedFrom = src;
    if (session.mode === "freecell") {
        const s = src;
        const head = getSelectedHeadCardFreecell(session.state, s);
        uiState.statusText = cardLabelGeneric(head);
    }
    else if (session.mode === "klondike") {
        const s = src;
        const head = getSelectedHeadCardKlondike(session.state, s);
        uiState.statusText = cardLabelGeneric(head);
    }
    else if (session.mode === "spider") {
        const s = src;
        const head = getSelectedHeadCardSpider(session.state, s);
        uiState.statusText = cardLabelGeneric(head);
    }
    log(`[SEL ${ts()}] drag-start selection set: ${uiState.statusText}`);
}
function selectSourceGeneric(src) {
    if (uiState.cleared)
        return;
    if (!session)
        return;
    // ---- Klondike 専用：列タップ／カードタップ → 動かせる束の先頭にスナップ ----
    if (session.mode === "klondike") {
        const s0 = src;
        if (s0.srcType === "tableau") {
            const st = session.state;
            const col = st.tableaus[s0.colIndex];
            if (col && col.length) {
                let chosenStart;
                // タップされた位置から下方向に、「実際に動かせる束」の起点を探す
                for (let idx = s0.cardIndex; idx < col.length; idx++) {
                    const seq = getMovableStackFromTableau(st, s0.colIndex, idx);
                    if (seq.length > 0) {
                        chosenStart = idx;
                        break;
                    }
                }
                if (chosenStart === undefined) {
                    uiState.selectedFrom = undefined;
                    uiState.statusText = "動かせない";
                    rerender();
                    return;
                }
                // 実際に動かせる束の先頭に置き換える
                src = {
                    srcType: "tableau",
                    colIndex: s0.colIndex,
                    cardIndex: chosenStart,
                };
            }
        }
    }
    // ★ ここで「同一ソース・短時間2クリック」を検出して foundation 送り
    if (session.mode === "freecell" || session.mode === "klondike") {
        if (tryHandleDoubleClick(src)) {
            // 自動送りを発火したので選択更新・描画は自動処理に任せる
            return;
        }
    }
    let same = false;
    if (session.mode === "freecell") {
        if (uiState.selectedFrom) {
            same = sameSourceFreecell(uiState.selectedFrom, src);
        }
    }
    else if (session.mode === "klondike") {
        if (uiState.selectedFrom) {
            same = sameSourceKlondike(uiState.selectedFrom, src);
        }
    }
    else if (session.mode === "spider") {
        if (uiState.selectedFrom) {
            same = sameSourceSpider(uiState.selectedFrom, src);
        }
    }
    if (same) {
        uiState.selectedFrom = undefined;
        uiState.statusText = "選択解除";
        rerender();
        return;
    }
    uiState.selectedFrom = src;
    // ★ 選択時は「選択したカードのスート＋ランク」を表示（束でも先頭1枚）
    if (session.mode === "freecell") {
        const s = src;
        const head = getSelectedHeadCardFreecell(session.state, s);
        uiState.statusText = cardLabelGeneric(head);
    }
    else if (session.mode === "klondike") {
        const s = src;
        const head = getSelectedHeadCardKlondike(session.state, s);
        uiState.statusText = cardLabelGeneric(head);
    }
    else {
        const s = src;
        const head = getSelectedHeadCardSpider(session.state, s);
        uiState.statusText = cardLabelGeneric(head);
    }
    log(`[SEL ${ts()}] select ${JSON.stringify(src)} head=${uiState.statusText}`);
    // ダブルタップ猶予（この直後の pointerdown ではドラッグ開始しない）
    armDblClickWindow();
    rerender();
}
function clickDestinationGeneric(dest) {
    if (!session)
        return;
    if (!uiState.selectedFrom)
        return;
    if (uiState.cleared)
        return;
    log(`[SEL ${ts()}] click-dest ${JSON.stringify(dest)} from=${JSON.stringify(uiState.selectedFrom)}`);
    if (session.mode === "freecell") {
        const result = tryMoveByRefsFreecell(uiState.selectedFrom, dest);
        if (!result.ok) {
            uiState.selectedFrom = undefined;
            rerender();
        }
        return;
    }
    if (session.mode === "klondike") {
        const result = tryMoveByRefsKlondike(uiState.selectedFrom, dest);
        if (!result.ok) {
            uiState.selectedFrom = undefined;
            rerender();
        }
        return;
    }
    if (session.mode === "spider") {
        const result = tryMoveByRefsSpider(uiState.selectedFrom, dest);
        if (!result.ok) {
            uiState.selectedFrom = undefined;
            rerender();
        }
        return;
    }
}
function emptyBoardClick() {
    if (uiState.selectedFrom) {
        uiState.selectedFrom = undefined;
        uiState.statusText = "選択解除";
        log(`[SEL ${ts()}] empty board -> clear selection`);
        rerender();
    }
}
function autoToFoundationGeneric(src) {
    if (!session)
        return;
    log(`[AUTO ${ts()}] request from src=${JSON.stringify(src)} mode=${session.mode}`);
    if (session.mode === "freecell") {
        tryMoveByRefsFreecell(src, { destType: "foundation" });
    }
    else if (session.mode === "klondike") {
        autoToFoundationKlondike(src);
    }
    // spiderはなし
}
// -------------------------------------------------
// 山札操作
// -------------------------------------------------
function klondikeDrawFromStockOnce() {
    if (!session || session.mode !== "klondike")
        return;
    const st = session.state;
    const level = session.level;
    const drawCount = level >= 3 ? 3 : 1;
    if (!st.stock || st.stock.length === 0) {
        if (st.waste && st.waste.length > 0) {
            session.snapshot();
            let recycled = 0;
            while (st.waste.length > 0) {
                const c = st.waste.pop();
                if (c) {
                    c.faceUp = false;
                    st.stock.push(c);
                    recycled++;
                }
            }
            session.recordMove({ type: "klondikeStockRecycle", count: recycled });
            uiState.statusText = "山札をリサイクル";
        }
        else {
            // 状態が変わらない操作はUNDO履歴・手数に積まない
            uiState.statusText = "山札なし";
        }
    }
    else {
        session.snapshot();
        let moved = 0;
        for (let i = 0; i < drawCount; i++) {
            if (!st.stock.length)
                break;
            const c = st.stock.pop();
            if (!c)
                break;
            c.faceUp = true;
            st.waste.push(c);
            moved++;
        }
        if (moved > 0) {
            session.recordMove({ type: "klondikeStockDraw", count: moved });
            uiState.statusText = `山札から${moved}枚ドロー`;
        }
        else {
            uiState.statusText = "山札なし";
        }
    }
    uiState.selectedFrom = undefined;
    uiState.cleared = false;
    log(`[KLONDIKE ${ts()}] stock draw -> ${uiState.statusText}`);
    rerender();
}
// -------------------------------------------------
// UNDO / NEW GAME / 画面遷移
// -------------------------------------------------
function undoOneMove() {
    if (!session)
        return;
    cancelFinishingNoMsg();
    const animObj = window.spiderAnim;
    if (animObj && animObj.active) {
        animObj.active = false;
        if (animObj.timer != null) {
            clearTimeout(animObj.timer);
            animObj.timer = null;
        }
    }
    const ok = session.undo();
    if (ok) {
        uiState.selectedFrom = undefined;
        uiState.cleared = false;
        uiState.statusText = "1手戻した";
        log(`[UNDO ${ts()}] ok=true`);
        rerender();
    }
    else {
        uiState.statusText = "戻せない";
        log(`[UNDO ${ts()}] ok=false`);
        rerender();
    }
}
function openNewGameMenu() {
    if (!session)
        return;
    cancelFinishingNoMsg();
    uiState.showNewGameMenu = true;
    rerender();
}
async function resolveSeedForStart(mode, level) {
    if (!clearGuaranteeEnabled) {
        return {
            seed: Math.floor(Math.random() * 2 ** 32) >>> 0,
            source: "random",
        };
    }
    startBusy = true;
    menuNetworkStatus = "クリア保証seedを取得中...";
    if (screen === "menu")
        rerender();
    try {
        const got = await fetchGuaranteedSeed(mode, level, getDealVersion(mode));
        if (!got) {
            menuNetworkStatus = `このゲームのレベル${level}には、クリア済みseedがまだありません`;
            return null;
        }
        menuNetworkStatus = `クリア保証seedから開始（登録済み ${got.count}件）`;
        return { seed: got.seed >>> 0, source: "guaranteed" };
    }
    catch (err) {
        log(`[GUARANTEE ${ts()}] fetch failed`, err);
        menuNetworkStatus = "クリア保証サーバーへ接続できません";
        return null;
    }
    finally {
        startBusy = false;
        if (screen === "menu")
            rerender();
    }
}
function beginSession(mode, level, seed, source, logKind) {
    cancelFinishingNoMsg();
    const animObj = window.spiderAnim;
    if (animObj) {
        animObj.active = false;
        if (animObj.timer != null) {
            clearTimeout(animObj.timer);
            animObj.timer = null;
        }
    }
    currentSeedSource = source;
    session = new GameSession(mode, level, seed >>> 0);
    uiState = {
        selectedFrom: undefined,
        statusText: source === "guaranteed" ? "クリア保証seed" : "",
        cleared: false,
        showNewGameMenu: false,
    };
    screen = "game";
    menuNetworkStatus = "";
    log(`[${logKind} ${ts()}] ${mode} L${level} seed=${seed >>> 0} source=${source}`);
    rerender();
}
async function chooseNewGameOption(opt) {
    if (!session) {
        uiState.showNewGameMenu = false;
        rerender();
        return;
    }
    const mode = session.mode;
    let targetLevel = session.level;
    if (opt === "cancel") {
        uiState.showNewGameMenu = false;
        rerender();
        return;
    }
    if (opt === "retry") {
        const seed = session.seed >>> 0;
        const source = currentSeedSource;
        beginSession(mode, session.level, seed, source, "NEW");
        return;
    }
    if (opt === "level1")
        targetLevel = 1;
    else if (opt === "level2")
        targetLevel = 2;
    else if (opt === "level3")
        targetLevel = 3;
    const resolved = await resolveSeedForStart(mode, targetLevel);
    if (!resolved) {
        uiState.showNewGameMenu = false;
        // ゲーム中のNEW GAMEから保証seed取得に失敗した場合は、現在の盤面を維持する。
        uiState.statusText = menuNetworkStatus;
        rerender();
        return;
    }
    beginSession(mode, targetLevel, resolved.seed, resolved.source, "NEW");
}
async function startGame(mode, level) {
    const resolved = await resolveSeedForStart(mode, level);
    if (!resolved)
        return;
    beginSession(mode, level, resolved.seed, resolved.source, "START");
}
function backToMenu() {
    cancelFinishingNoMsg();
    const animObj = window.spiderAnim;
    if (animObj) {
        animObj.active = false;
        if (animObj.timer != null) {
            clearTimeout(animObj.timer);
            animObj.timer = null;
        }
    }
    screen = "menu";
    uiState = {
        selectedFrom: undefined,
        statusText: "",
        cleared: false,
        showNewGameMenu: false,
    };
    session = null;
    pendingMode = undefined;
    log(`[NEW ${ts()}] back to menu`);
    rerender();
}
function clearToMenu() {
    backToMenu();
}
function clearReplayLevelSelect() {
    if (!session) {
        backToMenu();
        return;
    }
    const mode = session.mode;
    cancelFinishingNoMsg();
    const animObj = window.spiderAnim;
    if (animObj) {
        animObj.active = false;
        if (animObj.timer != null) {
            clearTimeout(animObj.timer);
            animObj.timer = null;
        }
    }
    screen = "menu";
    session = null;
    uiState = {
        selectedFrom: undefined,
        statusText: "",
        cleared: false,
        showNewGameMenu: false,
    };
    pendingMode = mode;
    log(`[NEW ${ts()}] clear replay -> menu (pending ${mode})`);
    rerender();
}
// -------------------------------------------------
// レイアウトスケール（スマホ / 縦横対応）
// -------------------------------------------------
// 盤面外形の基準横幅（board 870 + padding等で約910）
const BASE_APP_WIDTH = 900;
const BASE_APP_HEIGHT = 800;
// #app を専用ラッパに移して、そこで transform scale を掛けます。
function ensureScaleShell() {
    const app = document.getElementById("app");
    if (!app)
        return;
    let felt = document.getElementById("felt-wrapper");
    if (!felt) {
        felt = document.createElement("div");
        felt.id = "felt-wrapper";
        felt.style.position = "fixed";
        felt.style.inset = "0";
        felt.style.overflow = "hidden"; // はみ出し防止
        document.body.appendChild(felt);
    }
    let wrap = document.getElementById("game-scale-wrapper");
    if (!wrap) {
        wrap = document.createElement("div");
        wrap.id = "game-scale-wrapper";
        wrap.style.position = "fixed";
        wrap.style.left = "var(--stage-left)";
        wrap.style.top = "0";
        wrap.style.transformOrigin = "top left";
        wrap.style.transform = "scale(var(--app-scale))";
        felt.appendChild(wrap);
    }
    else {
        wrap.style.left = "var(--stage-left)";
        wrap.style.top = "0";
        wrap.style.transformOrigin = "top left";
        wrap.style.transform = "scale(var(--app-scale))";
    }
    if (app.parentElement !== wrap) {
        wrap.appendChild(app);
    }
    ensureUiGapDock();
}
function updateAppScale() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scaleByWidth = vw / BASE_APP_WIDTH;
    const scaleByHeight = vh / BASE_APP_HEIGHT;
    const baseScale = Math.min(1, scaleByWidth, scaleByHeight);
    const cs = getComputedStyle(document.documentElement);
    const raw = cs.getPropertyValue("--user-zoom-mult").trim();
    const userMult = (() => {
        const v = parseFloat(raw || "1");
        if (!Number.isFinite(v))
            return 1;
        return Math.max(0.5, Math.min(2.0, v));
    })();
    const scale = baseScale * userMult;
    const scaledW = BASE_APP_WIDTH * scale;
    const leftMargin = Math.max((vw - scaledW) / 2, 0);
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty("--app-scale", scale.toString());
    rootStyle.setProperty("--stage-left", `${leftMargin}px`);
}
function afterRenderScale() {
    requestAnimationFrame(() => {
        updateAppScale();
        updateUiGapDock();
    });
}
window.addEventListener("resize", () => {
    updateAppScale();
    updateUiGapDock();
});
window.addEventListener("orientationchange", () => {
    updateAppScale();
    updateUiGapDock();
});
// GitHub公開版にだけ残っていた FreeCell 上部中央UIの配置補正をソースへ復元。
let uiGapDock = null;
function ensureUiGapDock() {
    const wrap = document.getElementById("game-scale-wrapper");
    if (!wrap || uiGapDock)
        return;
    const dock = document.createElement("div");
    dock.id = "ui-gap-dock";
    dock.style.position = "absolute";
    dock.style.zIndex = "60";
    dock.style.pointerEvents = "auto";
    wrap.appendChild(dock);
    uiGapDock = dock;
}
function getCurrentAppScale() {
    const cs = getComputedStyle(document.documentElement);
    const value = parseFloat((cs.getPropertyValue("--app-scale") || "1").trim());
    return Number.isFinite(value) && value > 0 ? value : 1;
}
function updateUiGapDock() {
    const wrap = document.getElementById("game-scale-wrapper");
    if (!wrap || !uiGapDock)
        return;
    if (screen !== "game" || !session || session.mode !== "freecell") {
        uiGapDock.style.display = "none";
        return;
    }
    const freecell4 = document.querySelector('[data-drop="freecell-3"]');
    const foundation1 = document.querySelector('[data-drop="foundation-0"]');
    if (!freecell4 || !foundation1) {
        uiGapDock.style.display = "none";
        return;
    }
    const scale = getCurrentAppScale();
    const wrapRect = wrap.getBoundingClientRect();
    const freeRect = freecell4.getBoundingClientRect();
    const foundationRect = foundation1.getBoundingClientRect();
    const centerX = (freeRect.right + foundationRect.left) * 0.5;
    const topY = freeRect.top;
    const x = (centerX - wrapRect.left) / scale;
    const y = (topY - wrapRect.top) / scale;
    uiGapDock.style.left = `${x}px`;
    uiGapDock.style.top = `${y}px`;
    uiGapDock.style.display = "block";
    moveGapUiIntoDock();
}
function moveGapUiIntoDock() {
    if (!uiGapDock)
        return;
    const zoomById = document.getElementById("zoom-controls");
    const zoomByClass = zoomById ? null : document.querySelector(".zoom-controls");
    const zoom = zoomById || zoomByClass;
    if (zoom && zoom.parentElement !== uiGapDock) {
        uiGapDock.appendChild(zoom);
    }
    const statusById = document.getElementById("status-text");
    const statusByClass = statusById ? null : document.querySelector(".status-text");
    const status = statusById || statusByClass;
    if (status && status.parentElement !== uiGapDock) {
        uiGapDock.appendChild(status);
    }
}
// -------------------------------------------------
// D&D コア配線（共通）
// -------------------------------------------------
function parseDrop(el) {
    const raw = el.dataset.drop || "";
    const [kind, idxStr] = raw.split("-");
    const idx = idxStr !== undefined ? parseInt(idxStr, 10) : undefined;
    switch (session?.mode) {
        case "freecell":
            if (kind === "column" && idx !== undefined)
                return { el, dest: { destType: "column", colIndex: idx } };
            if (kind === "freecell" && idx !== undefined)
                return { el, dest: { destType: "freecell", freecellIndex: idx } };
            if (kind === "foundation")
                return { el, dest: { destType: "foundation", foundationIndex: idx } };
            break;
        case "klondike":
            if (kind === "tableau" && idx !== undefined)
                return { el, dest: { destType: "tableau", colIndex: idx } };
            if (kind === "foundation" && idx !== undefined)
                return { el, dest: { destType: "foundation", foundationIndex: idx } };
            break;
        case "spider":
            if (kind === "tableau" && idx !== undefined)
                return { el, dest: { destType: "tableau", colIndex: idx } };
            break;
    }
    return null;
}
const dnd = createDnD({
    // ★ srcRef も渡す
    buildGhost: (src, ev) => buildStackGhostFromClickedCard(src, ev),
    hitTestDest: (x, y) => {
        const el = findDropElementAtPoint(x, y);
        if (!el)
            return null;
        return parseDrop(el);
    },
    canDrop: () => true, // 実際の可否は tryMoveByRefs* が判定
    onDrop: (src, dest) => {
        if (!session)
            return;
        log(`[DND ${ts()}] drop -> ${JSON.stringify(dest)} (src=${JSON.stringify(src)})`);
        switch (session.mode) {
            case "freecell":
                tryMoveByRefsFreecell(src, dest);
                break;
            case "klondike":
                tryMoveByRefsKlondike(src, dest);
                break;
            case "spider":
                tryMoveByRefsSpider(src, dest);
                break;
        }
        rerender();
    },
    onCancel: () => { log(`[DND ${ts()}] cancel`); },
    ghostOffset: { x: 36, y: 50 },
});
// -------------------------------------------------
// 画面描画
// -------------------------------------------------
function rerender() {
    ensureScaleShell();
    const rootEl = document.getElementById("app");
    if (!rootEl)
        throw new Error("#app が見つからない");
    if (screen === "menu") {
        renderMenuScreen(rootEl, pendingMode, {
            guaranteeEnabled: clearGuaranteeEnabled,
            pendingSeedCount: pendingClearSeedCount(),
            statusText: menuNetworkStatus,
            startBusy,
        }, {
            onSelectMode: (mode) => {
                pendingMode = mode;
                menuNetworkStatus = "";
                rerender();
            },
            onBackModeSelect: () => {
                pendingMode = undefined;
                menuNetworkStatus = "";
                rerender();
            },
            onToggleGuarantee: () => {
                clearGuaranteeEnabled = !clearGuaranteeEnabled;
                saveClearGuaranteeEnabled(clearGuaranteeEnabled);
                menuNetworkStatus = clearGuaranteeEnabled
                    ? "クリア保証をONにしました"
                    : "通常ランダムに戻しました";
                rerender();
            },
            onStartGame: (mode, level) => {
                void startGame(mode, level);
            },
            onExportSeeds: () => {
                downloadClearSeedBackup();
            },
            onImportSeeds: () => {
                openClearSeedImportPicker();
            },
            onSyncSeeds: () => {
                void syncPendingSeeds(true);
            },
        });
        afterRenderScale();
        return;
    }
    if (screen === "game") {
        if (!session)
            throw new Error("sessionが無いのにgame画面");
        const gameClearedNow = isGameClearedNow(session);
        const gameCleared = !!uiState.cleared || gameClearedNow;
        const readyForFinish = computeReadyForFinish(session);
        if (session.mode === "freecell") {
            const stFC = session.state;
            const maxLen = calcMaxMovableLen(stFC);
            const movableColumns = {};
            stFC.columns.forEach((col, colIndex) => {
                if (!col.length)
                    return;
                for (let startIdx = 0; startIdx < col.length; startIdx++) {
                    const seqFull = getStackFromColumn(stFC, colIndex, startIdx);
                    if (!seqFull.length)
                        continue;
                    if (seqFull.length <= maxLen) {
                        if (!movableColumns[colIndex])
                            movableColumns[colIndex] = {};
                        movableColumns[colIndex][startIdx] = true;
                    }
                }
            });
            const movableMap = {
                columns: movableColumns,
                freecells: (() => {
                    const m = {};
                    stFC.freecells.forEach((c, i) => {
                        if (c)
                            m[i] = true;
                    });
                    return m;
                })(),
                foundations: (() => {
                    const m = {};
                    stFC.foundations.forEach((pile, fIndex) => {
                        if (pile.length > 0)
                            m[fIndex] = true;
                    });
                    return m;
                })()
            };
            const highlightColumns = {};
            const highlightFree = {};
            const highlightFound = {};
            if (uiState.selectedFrom && uiState.selectedFrom.srcType) {
                const s = uiState.selectedFrom;
                if (s.srcType === "column") {
                    const seqFull = getStackFromColumn(stFC, s.colIndex, s.startIndex);
                    if (seqFull.length > 0 && seqFull.length <= maxLen) {
                        for (let off = 0; off < seqFull.length; off++) {
                            const idxInCol = s.startIndex + off;
                            if (!highlightColumns[s.colIndex]) {
                                highlightColumns[s.colIndex] = {};
                            }
                            highlightColumns[s.colIndex][idxInCol] = true;
                        }
                    }
                }
                else if (s.srcType === "freecell") {
                    highlightFree[s.freecellIndex] = true;
                }
                else if (s.srcType === "foundation") {
                    highlightFound[s.foundationIndex] = true;
                }
            }
            const highlightMap = {
                columns: highlightColumns,
                freecells: highlightFree,
                foundations: highlightFound
            };
            renderGameScreen(rootEl, session, uiState, movableMap, highlightMap, readyForFinish, finishing, gameCleared, {
                onBackToMenu: () => backToMenu(),
                onUndoClick: () => undoOneMove(),
                onFinishClick: () => startFinishing(),
                onNewGameClick: () => openNewGameMenu(),
                onChooseNewGameOption: (opt) => chooseNewGameOption(opt),
                onClearToMenuClick: () => clearToMenu(),
                onClearReplayClick: () => clearReplayLevelSelect(),
                onSelectSource: (srcRef) => selectSourceGeneric(srcRef),
                onColumnCardTap: (colIndex, idxInCol) => {
                    if (uiState.cleared)
                        return;
                    if (!session)
                        return;
                    const st = session.state;
                    const col = st.columns[colIndex];
                    if (!col.length)
                        return;
                    const movableStarts = [];
                    for (let startIdx = 0; startIdx < col.length; startIdx++) {
                        const fullSeq = getStackFromColumn(st, colIndex, startIdx);
                        if (!fullSeq.length)
                            continue;
                        if (fullSeq.length <= calcMaxMovableLen(st)) {
                            movableStarts.push(startIdx);
                        }
                    }
                    if (!movableStarts.length) {
                        uiState.selectedFrom = undefined;
                        uiState.statusText = "動かせない";
                        rerender();
                        return;
                    }
                    let chosenStart = movableStarts.find(s => s >= idxInCol);
                    if (chosenStart === undefined) {
                        chosenStart = movableStarts[movableStarts.length - 1];
                    }
                    const srcRef = {
                        srcType: "column",
                        colIndex,
                        startIndex: chosenStart
                    };
                    // ★ FreeCellでも自前ダブルクリック判定を挟む
                    if (tryHandleDoubleClick(srcRef))
                        return;
                    uiState.selectedFrom = srcRef;
                    const head = col[chosenStart];
                    uiState.statusText = cardLabelGeneric(head);
                    log(`[SEL ${ts()}] FreeCell tap col=${colIndex} -> start=${chosenStart} head=${uiState.statusText}`);
                    // ダブルタップ猶予
                    armDblClickWindow();
                    rerender();
                },
                onClickDestination: (destRef) => clickDestinationGeneric(destRef),
                onAutoToFoundation: (srcRef) => autoToFoundationGeneric(srcRef),
                onDragStart: (srcRef, ev) => startDragWithDblclickGuard(srcRef, ev),
                onEmptyBoardClick: () => emptyBoardClick(),
            });
            afterRenderScale();
            return;
        }
        if (session.mode === "klondike") {
            renderKlondikeScreen(rootEl, session, uiState, readyForFinish, finishing, gameCleared, {
                onBackToMenu: () => backToMenu(),
                onUndoClick: () => undoOneMove(),
                onFinishClick: () => startFinishing(),
                onNewGameClick: () => openNewGameMenu(),
                onChooseNewGameOption: (opt) => chooseNewGameOption(opt),
                onClearToMenuClick: () => clearToMenu(),
                onClearReplayClick: () => clearReplayLevelSelect(),
                onSelectSource: (srcRef) => selectSourceGeneric(srcRef),
                onClickDestination: (destRef) => clickDestinationGeneric(destRef),
                onAutoToFoundation: (srcRef) => autoToFoundationGeneric(srcRef),
                onDragStart: (srcRef, ev) => startDragWithDblclickGuard(srcRef, ev),
                onEmptyBoardClick: () => emptyBoardClick(),
                onStockClick: () => klondikeDrawFromStockOnce(),
                // 列中カードタップで可動束の先頭にスナップ
                onColumnCardTap: (colIndex, cardIndex) => {
                    if (uiState.cleared)
                        return;
                    if (!session)
                        return;
                    const st = session.state;
                    const col = st.tableaus[colIndex];
                    if (!col || !col.length) {
                        uiState.selectedFrom = undefined;
                        uiState.statusText = "動かせない";
                        rerender();
                        return;
                    }
                    let chosenStart;
                    for (let idx = cardIndex; idx < col.length; idx++) {
                        const seq = getMovableStackFromTableau(st, colIndex, idx);
                        if (seq.length > 0) {
                            chosenStart = idx;
                            break;
                        }
                    }
                    if (chosenStart === undefined) {
                        uiState.selectedFrom = undefined;
                        uiState.statusText = "動かせない";
                        rerender();
                        return;
                    }
                    const srcRef = {
                        srcType: "tableau",
                        colIndex,
                        cardIndex: chosenStart,
                    };
                    // ★ Klondikeでも自前ダブルクリック判定を挟む
                    if (tryHandleDoubleClick(srcRef))
                        return;
                    uiState.selectedFrom = srcRef;
                    const head = col[chosenStart];
                    uiState.statusText = cardLabelGeneric(head);
                    log(`[SEL ${ts()}] Klondike tap col=${colIndex} -> card=${chosenStart} head=${uiState.statusText}`);
                    // ダブルタップ猶予
                    armDblClickWindow();
                    rerender();
                },
            });
            afterRenderScale();
            return;
        }
        if (session.mode === "spider") {
            const stSP = session.state;
            const highlightMap = buildSpiderHighlightMap(stSP, uiState.selectedFrom);
            renderSpiderScreen(rootEl, session, uiState, highlightMap, gameCleared, {
                onBackToMenu: () => backToMenu(),
                onUndoClick: () => undoOneMove(),
                onNewGameClick: () => openNewGameMenu(),
                onChooseNewGameOption: (opt) => chooseNewGameOption(opt),
                onClearToMenuClick: () => clearToMenu(),
                onClearReplayClick: () => clearReplayLevelSelect(),
                onSelectSource: (srcRef) => selectSourceGeneric(srcRef),
                onColumnCardTap: (colIndex, rowIndex) => onSpiderColumnCardTap(colIndex, rowIndex),
                onClickDestination: (destRef) => clickDestinationGeneric(destRef),
                onDragStart: (srcRef, ev) => startDragWithDblclickGuard(srcRef, ev),
                onStockClick: () => spiderDealFromStockOnce(),
                onEmptyBoardClick: () => emptyBoardClick(),
            });
            afterRenderScale();
            return;
        }
        const m = session?.mode;
        rootEl.innerHTML = `<div style="color:#fff">未実装モード: ${m}</div>`;
        afterRenderScale();
        return;
    }
}
// ズームUI起動
ZoomControls.start();
// 初期表示
rerender();
// GitHub Pages のアカウント/ドメイン移行に備え、起動時には過去seedを自動送信しない。
// メニューの「書き出し」でバックアップ後、「サーバーへ送信」を押した時だけ過去分を移送する。
// 端末内が空の状態で新規クリアしたseedは saveClearSeedLocal() から自動送信される。
