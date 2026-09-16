import { buildTopBar, buildNewGameOverlay, buildClearOverlay } from "./commonUI.js";
import { rankToLabel, suitGlyph, cardCssClassBySuit } from "./cardText.js";
// ========== CSS変数ヘルパ ==========
/** CSS変数(px)を数値として取得（失敗時は fallback） */
function cssPxNumber(varName, fallback) {
    const v = getComputedStyle(document.documentElement)
        .getPropertyValue(varName)
        .trim();
    const m = v.match(/^(-?\d+(?:\.\d+)?)px$/);
    return m ? parseFloat(m[1]) : fallback;
}
/** CSS変数(単位なしの number)を取得（失敗時は fallback） */
function cssNumber(varName, fallback) {
    const v = getComputedStyle(document.documentElement)
        .getPropertyValue(varName)
        .trim();
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
}
// ========== ダブルクリック / ダブルタップ検出（グローバル共有） ==========
let lastTapTime = 0;
let lastTapSrc = null;
function sameSrc(a, b) {
    if (!a || !b)
        return false;
    if (a.srcType !== b.srcType)
        return false;
    if (a.srcType === "tableau" && b.srcType === "tableau") {
        // 列は cardIndex を無視：途中→ヘッドの連続クリックでも同一列とみなす
        return a.colIndex === b.colIndex;
    }
    if (a.srcType === "waste" && b.srcType === "waste")
        return true;
    if (a.srcType === "foundation" && b.srcType === "foundation") {
        return a.foundationIndex === b.foundationIndex;
    }
    return false;
}
function resetTapState() {
    lastTapTime = 0;
    lastTapSrc = null;
}
// ========== ルール軽量判定（UI側） ==========
function suitColor(s) {
    // suitGlyph を使って安全に色を判定（♥♦=赤 / ♠♣=黒）
    const g = suitGlyph(s);
    return g === "♥" || g === "♦" ? "red" : "black";
}
/** テーブルロー上の cardIndex から末尾までが
 *  「1段降順」かつ「色交互」で連続しているなら true（＝ここがドラッグ可能ヘッド）
 */
function isTableauMovableHead(st, colIndex, cardIndex) {
    const col = st.tableaus[colIndex];
    const head = col[cardIndex];
    if (!head || !head.faceUp)
        return false;
    for (let i = cardIndex; i < col.length - 1; i++) {
        const a = col[i];
        const b = col[i + 1];
        if (!a.faceUp || !b.faceUp)
            return false;
        if (a.rank !== b.rank + 1)
            return false;
        if (suitColor(a.suit) === suitColor(b.suit))
            return false;
    }
    return true;
}
// ========== 選択中カードの強調判定 ==========
function isHighlighted(ui, kind, pileIdx, cardIdx, pileLen) {
    const sel = ui.selectedFrom;
    if (!sel)
        return false;
    if (kind === "tableau" && sel.srcType === "tableau") {
        // 同じ列で、選択した位置以降の束を全部光らせる
        return sel.colIndex === pileIdx && cardIdx >= sel.cardIndex;
    }
    if (kind === "waste" && sel.srcType === "waste") {
        // waste は末尾のみ
        return cardIdx === pileLen - 1;
    }
    if (kind === "foundation" && sel.srcType === "foundation") {
        // foundation の一番上だけ
        return sel.foundationIndex === pileIdx && cardIdx === pileLen - 1;
    }
    return false;
}
// ========== カードDOM生成（共通） ==========
// faceUp = true の場合はマーク・ランクを描く
// faceUp = false の場合は .card.back
function createCardDivCommon(card, highlight, leftPx, topPx, interactiveSrc, handlers, allowAutoToFound, plainClickHandler) {
    const div = document.createElement("div");
    if (!card.faceUp) {
        // 裏向き
        div.className = "card back";
    }
    else {
        // 表向き（色はスート由来で決定）
        div.className = cardCssClassBySuit(card.suit);
        const small = document.createElement("div");
        small.className = "card-header";
        // 左上表示は「スート → ランク」の順
        small.textContent = suitGlyph(card.suit) + rankToLabel(card.rank);
        div.appendChild(small);
        const center = document.createElement("div");
        center.className = "card-center";
        center.innerHTML = `
      <span class="center-suit">${suitGlyph(card.suit)}</span>
      <span class="center-rank">${rankToLabel(card.rank)}</span>
    `;
        div.appendChild(center);
    }
    if (highlight) {
        div.classList.add("card-selected-outline");
    }
    div.style.position = "absolute";
    div.style.left = `${leftPx}px`;
    div.style.top = `${topPx}px`;
    if (card.faceUp && interactiveSrc) {
        // ---- デスクトップ dblclick ----
        if (allowAutoToFound) {
            div.addEventListener("dblclick", (ev) => {
                ev.stopPropagation();
                resetTapState();
                handlers.onAutoToFoundation(interactiveSrc);
            });
        }
        // ---- 単クリック / ダブルタップ（フォールバック） ----
        div.addEventListener("click", (ev) => {
            ev.stopPropagation();
            const now = performance.now();
            const isDouble = allowAutoToFound && sameSrc(lastTapSrc, interactiveSrc) && now - lastTapTime < 400;
            if (isDouble) {
                resetTapState();
                handlers.onAutoToFoundation(interactiveSrc);
                return;
            }
            // シングル
            lastTapTime = now;
            lastTapSrc = interactiveSrc;
            handlers.onSelectSource(interactiveSrc);
        });
        // ---- ドラッグ開始 ----
        div.addEventListener("pointerdown", (ev) => {
            ev.stopPropagation();
            // preventDefault はしない：dblclick殺し防止
            handlers.onDragStart(interactiveSrc, ev);
        });
    }
    else if (plainClickHandler) {
        // 束ヘッドでない位置をクリック → 列内の「動かせる束」へスナップ
        div.addEventListener("click", (ev) => {
            ev.stopPropagation();
            // ダブルタップ判定用に“この列”を lastTapSrc に記録（cardIndexは無視される）
            lastTapTime = performance.now();
            // plainClick 側では colIndex / cardIndex が分からないので、呼び出し側で設定済みにする
            plainClickHandler();
        });
    }
    return div;
}
// ========== 各エリアDOM生成 ==========
// STOCK（山札）
function buildStockSlot(st, handlers) {
    const stockSlot = document.createElement("div");
    stockSlot.className = "slot stock-slot";
    stockSlot.style.position = "relative";
    stockSlot.dataset.stock = "1";
    // クリックでドロー
    stockSlot.addEventListener("click", (ev) => {
        ev.stopPropagation();
        resetTapState();
        handlers.onStockClick();
    });
    const n = st.stock.length;
    if (n > 0) {
        const backDiv = document.createElement("div");
        backDiv.className = "card back";
        backDiv.style.position = "absolute";
        backDiv.style.left = "0px";
        backDiv.style.top = "0px";
        stockSlot.appendChild(backDiv);
        const cnt = document.createElement("div");
        cnt.className = "stock-count";
        cnt.textContent = String(n);
        stockSlot.appendChild(cnt);
    }
    return stockSlot;
}
// WASTE（捨て札）
function buildWasteSlot(st, ui, handlers) {
    const CARD_W = cssPxNumber("--card-w", 72);
    const WASTE_STEP_X = cssPxNumber("--waste-step-x", 27);
    const WASTE_STEP_Y = cssPxNumber("--waste-step-y", 4);
    const WASTE_SCALE = cssNumber("--waste-scale", 0.9);
    const wasteLen = st.waste.length;
    const wasteSlot = document.createElement("div");
    wasteSlot.className = "slot waste-slot";
    wasteSlot.style.position = "relative";
    const widthPx = CARD_W + WASTE_STEP_X * Math.max(0, wasteLen - 1);
    wasteSlot.style.width = `${widthPx}px`;
    if (wasteLen === 0) {
        return wasteSlot;
    }
    for (let i = 0; i < wasteLen; i++) {
        const c = st.waste[i];
        const isTop = i === wasteLen - 1;
        const highlight = isHighlighted(ui, "waste", 0, i, wasteLen);
        const srcRef = isTop ? { srcType: "waste" } : null;
        const cardDiv = createCardDivCommon(c, highlight, i * WASTE_STEP_X, WASTE_STEP_Y, srcRef, handlers, 
        /*allowAutoToFound*/ true);
        cardDiv.style.transform = `scale(${WASTE_SCALE})`;
        cardDiv.style.transformOrigin = "top left";
        if (isTop && c.faceUp) {
            cardDiv.dataset.srcType = "waste";
        }
        wasteSlot.appendChild(cardDiv);
    }
    return wasteSlot;
}
// FOUNDATION
function buildFoundationGroup(st, ui, handlers) {
    const foundationGroup = document.createElement("div");
    foundationGroup.className = "foundation-group";
    for (let fIndex = 0; fIndex < st.foundations.length; fIndex++) {
        const pile = st.foundations[fIndex];
        const slot = document.createElement("div");
        slot.className = "slot foundation-slot-area";
        slot.dataset.drop = `foundation-${fIndex}`;
        // クリック＝移動先候補通知
        slot.addEventListener("click", (ev) => {
            ev.stopPropagation();
            resetTapState();
            handlers.onClickDestination({
                destType: "foundation",
                foundationIndex: fIndex,
            });
        });
        if (pile.length > 0) {
            const topCard = pile[pile.length - 1];
            const highlight = isHighlighted(ui, "foundation", fIndex, pile.length - 1, pile.length);
            const srcRef = {
                srcType: "foundation",
                foundationIndex: fIndex,
            };
            const cardDiv = createCardDivCommon(topCard, highlight, 0, 0, srcRef, handlers, 
            /*allowAutoToFound*/ false);
            cardDiv.classList.add("foundation-card");
            cardDiv.dataset.srcType = "foundation";
            cardDiv.dataset.foundationIndex = String(fIndex);
            slot.appendChild(cardDiv);
        }
        foundationGroup.appendChild(slot);
    }
    return foundationGroup;
}
// TABLEAU（場札7列）
function buildTableauArea(st, ui, handlers) {
    const FACE_GAP = cssPxNumber("--gap-faceup", 24);
    const BACK_GAP = cssPxNumber("--gap-facedown", 16);
    const columnsArea = document.createElement("div");
    columnsArea.className = "columns-area";
    const cols = st.tableaus;
    for (let ci = 0; ci < cols.length; ci++) {
        const col = cols[ci];
        const colStack = document.createElement("div");
        colStack.className = "column-stack";
        colStack.dataset.drop = `tableau-${ci}`;
        // 空白クリック＝2タップ目の置き先
        colStack.addEventListener("click", (ev) => {
            const t = ev.target;
            if (t.closest(".card"))
                return;
            ev.stopPropagation();
            resetTapState();
            handlers.onClickDestination({
                destType: "tableau",
                colIndex: ci,
            });
        });
        let currentTop = 0;
        for (let pi = 0; pi < col.length; pi++) {
            const c = col[pi];
            const highlight = isHighlighted(ui, "tableau", ci, pi, col.length);
            const canDragHead = c.faceUp && isTableauMovableHead(st, ci, pi);
            const srcRef = {
                srcType: "tableau",
                colIndex: ci,
                cardIndex: pi,
            };
            const cardDiv = createCardDivCommon(c, highlight, 0, currentTop, canDragHead ? srcRef : null, handlers, 
            /*allowAutoToFound*/ true, 
            // 非ヘッドをクリック → 列内の「実際に動ける束」へスナップ
            !canDragHead && c.faceUp
                ? () => {
                    // 1タップ目としてこの列を記録（cardIndexは sameSrc 判定で無視）
                    lastTapTime = performance.now();
                    lastTapSrc = { srcType: "tableau", colIndex: ci, cardIndex: pi };
                    handlers.onColumnCardTap(ci, pi);
                }
                : undefined);
            cardDiv.dataset.srcType = "tableau";
            cardDiv.dataset.colIndex = String(ci);
            cardDiv.dataset.cardIndex = String(pi);
            colStack.appendChild(cardDiv);
            currentTop += c.faceUp ? FACE_GAP : BACK_GAP;
        }
        columnsArea.appendChild(colStack);
    }
    return columnsArea;
}
// ========== メイン描画関数 ==========
export function renderKlondikeScreen(rootEl, session, ui, readyForFinish, finishing, gameCleared, handlers) {
    const st = session.state;
    rootEl.innerHTML = "";
    // === ルート ===
    const outer = document.createElement("div");
    outer.className = "game-root";
    // === board と同じ幅でまとめるフレーム ===
    const frame = document.createElement("div");
    frame.className = "board-frame";
    outer.appendChild(frame);
    // === 上バー（共通コンポーネント） ===
    const topBar = buildTopBar(session, {
        statusText: ui.statusText,
        readyForFinish,
        finishing,
        gameCleared,
    }, {
        onBackToMenu: () => handlers.onBackToMenu(),
        onNewGameClick: () => handlers.onNewGameClick(),
        onUndoClick: () => handlers.onUndoClick(),
        onFinishClick: () => handlers.onFinishClick(), // KlondikeはFINISH対応
    });
    frame.appendChild(topBar);
    // === 盤面 ===
    const board = document.createElement("div");
    board.className = "board klondike-board";
    // 上段: 左(山札) と 右(ファウンデーション)
    const topRow = document.createElement("div");
    topRow.className = "board-top-row";
    const leftGroup = document.createElement("div");
    leftGroup.className = "stock-waste-group";
    leftGroup.appendChild(buildStockSlot(st, handlers));
    const foundationGroup = buildFoundationGroup(st, ui, handlers);
    topRow.appendChild(leftGroup);
    topRow.appendChild(foundationGroup);
    board.appendChild(topRow);
    // 中段：ドロー（捨て札）
    const drawRow = document.createElement("div");
    drawRow.className = "draw-row";
    drawRow.appendChild(buildWasteSlot(st, ui, handlers));
    board.appendChild(drawRow);
    // 下段: tableau（7列）
    const columnsArea = buildTableauArea(st, ui, handlers);
    board.appendChild(columnsArea);
    // 盤面の何もない場所クリックで選択解除（ダブルタップ状態もリセット）
    board.addEventListener("click", () => {
        resetTapState();
        handlers.onEmptyBoardClick();
    });
    // 盤面も frame 内に配置
    frame.appendChild(board);
    // NEW GAMEオーバーレイ（共通）
    if (ui.showNewGameMenu && !gameCleared) {
        outer.appendChild(buildNewGameOverlay({
            onChooseNewGameOption: handlers.onChooseNewGameOption,
        }));
    }
    // クリアオーバーレイ（共通）
    if (gameCleared) {
        outer.appendChild(buildClearOverlay({
            onClearToMenuClick: handlers.onClearToMenuClick,
            onClearReplayClick: handlers.onClearReplayClick,
        }, { titleText: "CLEAR!", pulse: true }));
    }
    rootEl.appendChild(outer);
}
