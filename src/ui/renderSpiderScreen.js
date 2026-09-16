// src/ui/renderSpiderScreen.ts
import { buildTopBar, buildNewGameOverlay, buildClearOverlay, } from "./commonUI.js";
import { rankToLabel, suitGlyph, cardCssClassBySuit } from "./cardText.js";
/** CSS変数(px)を数値として取得（失敗時は fallback） */
function cssPxNumber(varName, fallback) {
    const v = getComputedStyle(document.documentElement)
        .getPropertyValue(varName)
        .trim();
    const m = v.match(/^(-?\d+(?:\.\d+)?)px$/);
    return m ? parseFloat(m[1]) : fallback;
}
/** 列の cardIndex から末尾までが
 *  「同スート」かつ「1段降順」で連続しているなら true（＝ここがドラッグ可能ヘッド）
 *  途中に裏面があれば不可
 */
function isSpiderMovableHead(col, cardIndex) {
    const head = col[cardIndex];
    if (!head || !head.faceUp)
        return false;
    for (let i = cardIndex; i < col.length - 1; i++) {
        const a = col[i];
        const b = col[i + 1];
        if (!a.faceUp || !b.faceUp)
            return false;
        if (a.suit !== b.suit)
            return false;
        if (a.rank !== b.rank + 1)
            return false;
    }
    return true; // 単独カードもOK
}
export function renderSpiderScreen(rootEl, session, uiState, highlightMap, gameCleared, handlers) {
    const st = session.state;
    rootEl.innerHTML = "";
    const outer = document.createElement("div");
    outer.className = "game-root";
    // board と同じ幅でまとめるフレーム
    const frame = document.createElement("div");
    frame.className = "board-frame";
    outer.appendChild(frame);
    // ===== トップバー（共通） =====
    const topBar = buildTopBar(session, {
        statusText: uiState.statusText,
        // SpiderはFINISH未対応
        readyForFinish: false,
        finishing: false,
        gameCleared: gameCleared || uiState.cleared,
    }, {
        onBackToMenu: () => handlers.onBackToMenu(),
        onNewGameClick: () => handlers.onNewGameClick(),
        onUndoClick: () => handlers.onUndoClick(),
        // onFinishClick は渡さない
    });
    // トップバーは frame 内（board と同幅）
    frame.appendChild(topBar);
    // ===== 盤面全体 =====
    const board = document.createElement("div");
    board.className = "board spider-board";
    // 盤面クリックで選択解除（他モードと統一）
    board.addEventListener("click", () => {
        handlers.onEmptyBoardClick();
    });
    // --- 上段: 山札と完成済みセット数 ---
    const topRow = document.createElement("div");
    topRow.className = "board-top-row";
    // 左: stock (山札)
    {
        const stockGroup = document.createElement("div");
        stockGroup.className = "stock-waste-group";
        const stockSlot = document.createElement("div");
        stockSlot.className = "slot";
        // Spiderのstockはドロップ先にはならないので空
        stockSlot.dataset.drop = "";
        stockSlot.style.position = "relative";
        stockSlot.style.cursor = "pointer";
        // 残り何回配れるか（stock.length / 10）
        if (st.stock && st.stock.length > 0) {
            const remainingDeals = Math.floor(st.stock.length / 10);
            const badge = document.createElement("div");
            badge.className = "stock-count";
            // 残回数を「○回」で表示
            badge.textContent = `${remainingDeals}回`;
            stockSlot.appendChild(badge);
        }
        stockSlot.addEventListener("click", () => {
            handlers.onStockClick();
        });
        stockGroup.appendChild(stockSlot);
        topRow.appendChild(stockGroup);
    }
    // 右: 完成済みセット本数 (completedStacks)
    {
        const doneGroup = document.createElement("div");
        doneGroup.className = "foundation-group";
        const doneSlot = document.createElement("div");
        doneSlot.className = "slot spider-done";
        doneSlot.style.cursor = "default";
        doneSlot.style.color = "#00ff9c";
        doneSlot.style.fontWeight = "700";
        doneSlot.style.fontSize = "20px";
        doneSlot.style.textAlign = "center";
        // カード高に追従（CSS変数。未設定環境では100px想定）
        doneSlot.style.lineHeight = "var(--card-h, 100px)";
        // 完成した13～Aセット数を 0/8,1/8,... として出す
        doneSlot.textContent = `${st.completedStacks}/8`;
        doneGroup.appendChild(doneSlot);
        topRow.appendChild(doneGroup);
    }
    board.appendChild(topRow);
    // --- 下段: タブロー10列 ---
    const columnsArea = document.createElement("div");
    columnsArea.className = "columns-area";
    // 共通CSS変数に統一
    const COL_TOP_START = cssPxNumber("--column-top-padding", 4);
    const FACE_GAP = cssPxNumber("--gap-faceup", 24);
    const BACK_GAP = cssPxNumber("--gap-facedown", 16);
    st.columns.forEach((col, colIndex) => {
        const colWrap = document.createElement("div");
        colWrap.className = "column-stack";
        // ドロップターゲット認識用
        colWrap.dataset.drop = `tableau-${colIndex}`;
        // 列自体の空白クリック
        colWrap.addEventListener("click", (ev) => {
            const t = ev.target;
            if (t.closest(".card"))
                return;
            // 置き先指定（2タップ目）
            if (uiState.selectedFrom) {
                handlers.onClickDestination({
                    destType: "tableau",
                    colIndex,
                });
                return;
            }
            // 未選択なら最下段カード位置からのスナップ選択
            const lastIdx = col.length - 1;
            if (lastIdx >= 0) {
                handlers.onColumnCardTap(colIndex, lastIdx);
            }
            else {
                handlers.onEmptyBoardClick();
            }
        });
        // 縦方向オフセット
        let currentTop = COL_TOP_START;
        for (let cardIndex = 0; cardIndex < col.length; cardIndex++) {
            const card = col[cardIndex];
            const faceUp = card.faceUp;
            const cardEl = document.createElement("div");
            if (faceUp) {
                // 表向き：共通ユーティリティで色クラス付与
                cardEl.className = cardCssClassBySuit(card.suit);
            }
            else {
                // 裏向き
                cardEl.className = "card back";
            }
            cardEl.style.position = "absolute";
            cardEl.style.top = currentTop + "px";
            cardEl.style.left = "0px";
            // この位置がドラッグ可能ヘッドか判定（同スート降順で末尾まで続く）
            const canDragHead = faceUp && isSpiderMovableHead(col, cardIndex);
            if (faceUp && canDragHead) {
                // ドラッグ開始（pointerdown）※ヘッドのみ
                cardEl.addEventListener("pointerdown", (ev) => {
                    ev.stopPropagation();
                    // preventDefault はしない（クリック/ダブルクリックの邪魔をしない）
                    const srcRef = { srcType: "tableau", colIndex, cardIndex };
                    // 視覚整合のため選択も同期（任意）
                    handlers.onSelectSource(srcRef);
                    handlers.onDragStart(srcRef, ev);
                });
                // ヘッドは通常クリックで選択（スナップ不要）
                cardEl.addEventListener("click", (ev) => {
                    ev.stopPropagation();
                    handlers.onColumnCardTap(colIndex, cardIndex);
                });
            }
            else {
                // 非ヘッド部をクリックしたら、その列の「実際に動かせる束」をハイライト（FreeCell準拠）
                cardEl.addEventListener("click", (ev) => {
                    ev.stopPropagation();
                    handlers.onColumnCardTap(colIndex, cardIndex);
                });
            }
            // 表向きのカードだけ内容を描画
            if (faceUp) {
                const small = document.createElement("div");
                small.className = "card-header";
                // スート→ランク表示
                small.textContent = suitGlyph(card.suit) + rankToLabel(card.rank);
                cardEl.appendChild(small);
                const center = document.createElement("div");
                center.className = "card-center";
                center.innerHTML = `
          <span class="center-suit">${suitGlyph(card.suit)}</span>
          <span class="center-rank">${rankToLabel(card.rank)}</span>
        `;
                cardEl.appendChild(center);
            }
            // ハイライト（選択中束に .card-selected-outline を付与）
            const hlCol = highlightMap.columns[colIndex];
            if (hlCol && hlCol[cardIndex]) {
                cardEl.classList.add("card-selected-outline");
            }
            colWrap.appendChild(cardEl);
            // 裏/表でオフセット増分
            currentTop += faceUp ? FACE_GAP : BACK_GAP;
        }
        columnsArea.appendChild(colWrap);
    });
    board.appendChild(columnsArea);
    // board も frame 内に入れる（ヘッダーと同じ幅）
    frame.appendChild(board);
    // ===== クリア時オーバーレイ（共通） =====
    if (gameCleared || uiState.cleared) {
        outer.appendChild(buildClearOverlay({
            onClearToMenuClick: handlers.onClearToMenuClick,
            onClearReplayClick: handlers.onClearReplayClick,
        }, { titleText: "クリア！", pulse: true }));
    }
    // ===== NEW GAMEメニューオーバーレイ（共通） =====
    if (uiState.showNewGameMenu && !uiState.cleared && !gameCleared) {
        outer.appendChild(buildNewGameOverlay({
            onChooseNewGameOption: handlers.onChooseNewGameOption,
        }));
    }
    rootEl.appendChild(outer);
}
