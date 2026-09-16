// src/ui/renderGameScreen.ts (FreeCell用・統合版)
import { buildTopBar, buildNewGameOverlay, buildClearOverlay } from "./commonUI.js";
import { rankToLabel, suitGlyph, cardCssClassByColor } from "./cardText.js";
/** CSS変数(px)を数値として取得（失敗時は fallback） */
function cssPxNumber(varName, fallback) {
    const v = getComputedStyle(document.documentElement)
        .getPropertyValue(varName)
        .trim();
    const m = v.match(/^(-?\d+(?:\.\d+)?)px$/);
    return m ? parseFloat(m[1]) : fallback;
}
// ========== ダブルタップ判定用（FreeCell 全体で共有） ==========
let lastTapTime = 0;
let lastTapSrc = null;
function sameSrc(a, b) {
    if (!a || !b)
        return false;
    if (a.srcType !== b.srcType)
        return false;
    if (a.srcType === "column" && b.srcType === "column") {
        // ★ 列は startIndex を無視：1回目が列途中→2回目がヘッドでも同列ダブル判定を成立させる
        return a.colIndex === b.colIndex;
    }
    if (a.srcType === "freecell" && b.srcType === "freecell") {
        return a.freecellIndex === b.freecellIndex;
    }
    if (a.srcType === "foundation" && b.srcType === "foundation") {
        return a.foundationIndex === b.foundationIndex;
    }
    return false;
}
/**
 * カードDOM生成
 * highlight=true のときは card-selected-outline クラスを付与する
 * 透過は行わない
 *
 * ・canDragHead && sourceRef が true の場合
 *    - click: 通常選択
 *    - 「短時間(400ms以内)に同じ source への 2 回目の click/dblclick」:
 *         自動で foundation 送り (allowAutoToFound=true の場合)
 *    - pointerdown: ドラッグ開始（実ドラッグの判断は dnd 側）
 * ・それ以外で plainClickHandler が指定されている場合
 *    - click: plainClickHandler（列タップで“動かせる束”をハイライト）
 */
function createCardDiv(card, topOffset, canDragHead, highlight, sourceRef, allowAutoToFound, handlers, plainClickHandler) {
    const div = document.createElement("div");
    div.className = cardCssClassByColor(card.color);
    if (canDragHead)
        div.classList.add("card-head");
    if (highlight)
        div.classList.add("card-selected-outline");
    div.style.top = `${topOffset}px`;
    div.style.position = "absolute";
    const small = document.createElement("div");
    small.className = "card-header";
    // スート → ランク
    small.textContent = suitGlyph(card.suit) + rankToLabel(card.rank);
    div.appendChild(small);
    const center = document.createElement("div");
    center.className = "card-center";
    center.innerHTML = `
    <span class="center-suit">${suitGlyph(card.suit)}</span>
    <span class="center-rank">${rankToLabel(card.rank)}</span>
  `;
    div.appendChild(center);
    if (canDragHead && sourceRef) {
        // ---- ネイティブ dblclick（デスクトップ向け）----
        div.addEventListener("dblclick", (ev) => {
            ev.stopPropagation();
            if (allowAutoToFound) {
                lastTapTime = 0;
                lastTapSrc = null;
                handlers.onAutoToFoundation(sourceRef);
            }
        });
        // ---- 単タップ / ダブルタップ（タッチ・共通フォールバック） ----
        div.addEventListener("click", (ev) => {
            ev.stopPropagation();
            const now = performance.now();
            const isDouble = allowAutoToFound && sameSrc(lastTapSrc, sourceRef) && now - lastTapTime < 400;
            if (isDouble) {
                lastTapTime = 0;
                lastTapSrc = null;
                handlers.onAutoToFoundation(sourceRef);
                return;
            }
            // シングル
            lastTapTime = now;
            lastTapSrc = sourceRef;
            handlers.onSelectSource(sourceRef);
        });
        // ---- ドラッグ開始 ----
        div.addEventListener("pointerdown", (ev) => {
            ev.stopPropagation();
            // preventDefault はしない：クリック／ダブルクリックを殺さない
            handlers.onDragStart(sourceRef, ev);
        });
    }
    else if (plainClickHandler) {
        // 束の途中タップ → “動かせる束の先頭”へスナップ
        div.addEventListener("click", (ev) => {
            ev.stopPropagation();
            plainClickHandler();
        });
    }
    return div;
}
export function renderGameScreen(root, session, ui, movableMap, highlightMap, readyForFinish, finishing, gameCleared, handlers) {
    const state = session.state;
    root.innerHTML = "";
    const outer = document.createElement("div");
    outer.className = "game-root";
    // board と同じ幅でまとめるフレーム
    const frame = document.createElement("div");
    frame.className = "board-frame";
    outer.appendChild(frame);
    // --- 上バー（共通コンポーネント） ---
    const topBar = buildTopBar(session, {
        statusText: ui.statusText,
        readyForFinish,
        finishing,
        gameCleared,
    }, {
        onBackToMenu: () => handlers.onBackToMenu(),
        onNewGameClick: () => handlers.onNewGameClick(),
        onUndoClick: () => handlers.onUndoClick(),
        onFinishClick: () => handlers.onFinishClick(), // FreeCellはFINISH対応
    });
    frame.appendChild(topBar);
    // --- 盤面本体 ---
    const board = document.createElement("div");
    board.className = "board freecell-board";
    const topRow = document.createElement("div");
    topRow.className = "board-top-row";
    // フリーセル側(左ブロック)
    const freecellGroup = document.createElement("div");
    freecellGroup.className = "freecell-group";
    state.freecells.forEach((c, i) => {
        const slot = document.createElement("div");
        slot.className = "slot freecell-slot-area";
        slot.dataset.drop = `freecell-${i}`;
        // クリック＝移動先候補通知
        slot.addEventListener("click", (ev) => {
            ev.stopPropagation();
            lastTapTime = 0;
            lastTapSrc = null;
            handlers.onClickDestination({
                destType: "freecell",
                freecellIndex: i,
            });
        });
        if (c) {
            const canDrag = !!movableMap.freecells[i];
            const hl = !!highlightMap.freecells[i];
            const srcRef = canDrag
                ? { srcType: "freecell", freecellIndex: i }
                : null;
            const cardDiv = createCardDiv(c, 0, canDrag, hl, srcRef, 
            /*allowAutoToFound*/ true, handlers);
            freecellGroup.appendChild(slot);
            slot.appendChild(cardDiv);
        }
        else {
            freecellGroup.appendChild(slot);
        }
    });
    topRow.appendChild(freecellGroup);
    // foundation側(右ブロック)
    const foundationGroup = document.createElement("div");
    foundationGroup.className = "foundation-group";
    state.foundations.forEach((pile, fIndex) => {
        const slot = document.createElement("div");
        slot.className = "slot foundation-slot-area";
        slot.dataset.drop = `foundation-${fIndex}`;
        slot.addEventListener("click", (ev) => {
            ev.stopPropagation();
            lastTapTime = 0;
            lastTapSrc = null;
            handlers.onClickDestination({
                destType: "foundation",
                foundationIndex: fIndex,
            });
        });
        const topCard = pile.length > 0 ? pile[pile.length - 1] : null;
        if (topCard) {
            const canDrag = !!movableMap.foundations[fIndex];
            const hl = !!highlightMap.foundations[fIndex];
            const srcRef = canDrag
                ? { srcType: "foundation", foundationIndex: fIndex }
                : null;
            const cardDiv = createCardDiv(topCard, 0, canDrag, hl, srcRef, 
            /*allowAutoToFound*/ false, handlers);
            cardDiv.classList.add("foundation-card");
            foundationGroup.appendChild(slot);
            slot.appendChild(cardDiv);
        }
        else {
            foundationGroup.appendChild(slot);
        }
    });
    topRow.appendChild(foundationGroup);
    board.appendChild(topRow);
    // 列
    const columnsArea = document.createElement("div");
    columnsArea.className = "columns-area";
    // CSS変数から列内の縦間隔(px)を取得（既定 20px）
    const freecellGap = cssPxNumber("--freecell-gap", 20);
    state.columns.forEach((col, colIndex) => {
        const colStack = document.createElement("div");
        colStack.className = "column-stack";
        colStack.dataset.drop = `column-${colIndex}`;
        colStack.addEventListener("click", (ev) => {
            ev.stopPropagation();
            lastTapTime = 0;
            lastTapSrc = null;
            handlers.onClickDestination({
                destType: "column",
                colIndex,
            });
        });
        col.forEach((card, idxInCol) => {
            const canDragHead = !!(movableMap.columns[colIndex] &&
                movableMap.columns[colIndex][idxInCol]);
            const hl = !!(highlightMap.columns[colIndex] &&
                highlightMap.columns[colIndex][idxInCol]);
            const srcRef = canDragHead
                ? {
                    srcType: "column",
                    colIndex,
                    startIndex: idxInCol,
                }
                : null;
            const cardDiv = createCardDiv(card, idxInCol * freecellGap, canDragHead, hl, srcRef, 
            /*allowAutoToFound*/ true, handlers, () => {
                // canDragHead=false のとき用：列タップで「動かせる束の先頭」へスナップ
                handlers.onColumnCardTap(colIndex, idxInCol);
            });
            colStack.appendChild(cardDiv);
        });
        columnsArea.appendChild(colStack);
    });
    board.appendChild(columnsArea);
    // 盤面の何も無い場所タップで選択解除（ついでにダブルタップ状態もリセット）
    board.addEventListener("click", () => {
        lastTapTime = 0;
        lastTapSrc = null;
        handlers.onEmptyBoardClick();
    });
    // board も frame 内に収める
    frame.appendChild(board);
    // --- NEW GAMEメニュー用オーバーレイ（共通） ---
    if (ui.showNewGameMenu && !gameCleared) {
        outer.appendChild(buildNewGameOverlay({
            onChooseNewGameOption: handlers.onChooseNewGameOption,
        }));
    }
    // --- クリア時のオーバーレイ（共通） ---
    if (gameCleared) {
        outer.appendChild(buildClearOverlay({
            onClearToMenuClick: handlers.onClearToMenuClick,
            onClearReplayClick: handlers.onClearReplayClick,
        }, { titleText: "CLEAR!", pulse: true }));
    }
    root.appendChild(outer);
}
