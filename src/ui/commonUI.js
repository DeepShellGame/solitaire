export function buildTopBar(session, opts, handlers) {
    const topBar = document.createElement("div");
    topBar.className = "top-bar";
    // ===== レイアウト：左 / 中央（ログ） / 右 =====
    topBar.style.display = "flex";
    topBar.style.alignItems = "center";
    topBar.style.gap = "8px";
    topBar.style.flexWrap = "nowrap";
    // ---- 左：戻る / NEW GAME / UNDO / ズームスロット ----
    const left = document.createElement("div");
    left.className = "topbar-left";
    left.style.display = "flex";
    left.style.alignItems = "center";
    left.style.gap = "8px";
    left.style.flex = "0 0 auto";
    const back = document.createElement("button");
    back.className = "back-btn";
    back.textContent = "← タイトル";
    back.addEventListener("click", handlers.onBackToMenu);
    left.appendChild(back);
    const newGame = document.createElement("button");
    newGame.className = "back-btn";
    newGame.textContent = "NEW GAME";
    newGame.addEventListener("click", handlers.onNewGameClick);
    left.appendChild(newGame);
    const undo = document.createElement("button");
    undo.className = "back-btn";
    undo.textContent = "UNDO";
    undo.addEventListener("click", handlers.onUndoClick);
    left.appendChild(undo);
    // ★ ズームコントロールの固定スロット
    const zoomSlot = document.createElement("div");
    zoomSlot.id = "zoom-controls-slot";
    zoomSlot.className = "zoom-slot";
    zoomSlot.style.display = "flex";
    zoomSlot.style.alignItems = "center";
    zoomSlot.style.gap = "6px";
    zoomSlot.style.marginLeft = "6px";
    zoomSlot.style.flex = "0 0 auto";
    left.appendChild(zoomSlot);
    // ---- 中央：状態表示（可変・省略記号） ----
    const center = document.createElement("div");
    center.className = "topbar-center";
    center.style.flex = "1 1 auto";
    center.style.minWidth = "0"; // ellipsis を効かせる肝
    center.style.display = "flex";
    center.style.justifyContent = "center";
    const log = document.createElement("div");
    log.className = "top-bar-log";
    log.textContent = opts.statusText ?? "";
    log.style.whiteSpace = "nowrap";
    log.style.overflow = "hidden";
    log.style.textOverflow = "ellipsis";
    center.appendChild(log);
    // ---- 右：mode表示 / FINISH ----
    const right = document.createElement("div");
    right.className = "topbar-right";
    right.style.display = "flex";
    right.style.alignItems = "center";
    right.style.gap = "8px";
    right.style.flex = "0 0 auto";
    const modeLabel = document.createElement("div");
    modeLabel.textContent = `mode: ${session.mode}`;
    right.appendChild(modeLabel);
    const canShowFinish = !!handlers.onFinishClick &&
        !opts.gameCleared &&
        (opts.readyForFinish || opts.finishing);
    if (canShowFinish) {
        const finish = document.createElement("button");
        finish.className = "back-btn finish-btn";
        finish.textContent = opts.finishing ? "FINISH中..." : "FINISH";
        if (opts.finishing) {
            finish.disabled = true;
        }
        else {
            finish.addEventListener("click", handlers.onFinishClick);
        }
        right.appendChild(finish); // ★ 右側に配置（ズームを押し出さない）
    }
    topBar.appendChild(left);
    topBar.appendChild(center);
    topBar.appendChild(right);
    return topBar;
}
export function buildNewGameOverlay(handlers, titleText = "NEW GAME") {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    const panel = document.createElement("div");
    panel.className = "overlay-panel";
    const title = document.createElement("div");
    title.className = "overlay-title";
    title.textContent = titleText;
    panel.appendChild(title);
    const wrap = document.createElement("div");
    wrap.className = "overlay-btn-wrap";
    const make = (label, opt) => {
        const b = document.createElement("button");
        b.textContent = label;
        b.className = "overlay-btn";
        b.addEventListener("click", () => handlers.onChooseNewGameOption(opt));
        return b;
    };
    wrap.appendChild(make("同じ条件でもう一度", "retry"));
    wrap.appendChild(make("レベル1", "level1"));
    wrap.appendChild(make("レベル2", "level2"));
    wrap.appendChild(make("レベル3", "level3"));
    wrap.appendChild(make("キャンセル", "cancel"));
    panel.appendChild(wrap);
    overlay.appendChild(panel);
    return overlay;
}
export function buildClearOverlay(handlers, opts) {
    const titleText = opts?.titleText ?? "CLEAR!";
    const pulse = opts?.pulse ?? true;
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.left = "0";
    overlay.style.top = "0";
    overlay.style.width = "100%";
    overlay.style.height = "100%";
    overlay.style.background = "rgba(0,0,0,0.7)";
    overlay.style.display = "flex";
    overlay.style.flexDirection = "column";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "99999";
    overlay.style.color = "#00ff9c";
    overlay.style.textAlign = "center";
    if (pulse) {
        const styleEl = document.createElement("style");
        styleEl.textContent = `
@keyframes pulseClear {
  0%   { text-shadow:0 0 10px #00ff9c,0 0 20px #00ff9c; }
  50%  { text-shadow:0 0 20px #ffffff,0 0 40px #00ff9c; }
  100% { text-shadow:0 0 10px #00ff9c,0 0 20px #00ff9c; }
}`;
        overlay.appendChild(styleEl);
    }
    const title = document.createElement("div");
    title.textContent = titleText;
    title.style.fontSize = "64px";
    title.style.fontWeight = "bold";
    title.style.marginBottom = "24px";
    if (pulse)
        title.style.animation = "pulseClear 1s infinite";
    overlay.appendChild(title);
    const btnWrap = document.createElement("div");
    btnWrap.style.display = "flex";
    btnWrap.style.flexDirection = "column";
    btnWrap.style.gap = "12px";
    const make = (label, onClick) => {
        const b = document.createElement("button");
        b.textContent = label;
        b.style.background = "#222";
        b.style.border = "2px solid #00ff9c";
        b.style.color = "#00ff9c";
        b.style.borderRadius = "8px";
        b.style.padding = "12px 20px";
        b.style.fontSize = "18px";
        b.style.cursor = "pointer";
        b.addEventListener("click", onClick);
        return b;
    };
    btnWrap.appendChild(make("タイトルへ", handlers.onClearToMenuClick));
    btnWrap.appendChild(make("もう一度", handlers.onClearReplayClick));
    overlay.appendChild(btnWrap);
    return overlay;
}
