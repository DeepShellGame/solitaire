// src/ui/renderMenuScreen.ts
export function renderMenuScreen(root, pendingMode, opts, handlers) {
    root.innerHTML = "";
    const screen = document.createElement("div");
    screen.className = "menu-screen";
    const title = document.createElement("h1");
    title.className = "menu-title";
    title.textContent = "ソリティア";
    screen.appendChild(title);
    const sub = document.createElement("div");
    sub.className = "menu-subtitle";
    sub.textContent = "遊びたいゲームを選んでください";
    screen.appendChild(sub);
    if (!pendingMode) {
        const list = document.createElement("div");
        list.className = "menu-list";
        for (const [mode, label] of [
            ["freecell", "フリーセル"],
            ["klondike", "クロンダイク"],
            ["spider", "スパイダー"],
        ]) {
            const btn = document.createElement("button");
            btn.className = "menu-btn active";
            btn.textContent = label;
            btn.addEventListener("click", () => handlers.onSelectMode(mode));
            list.appendChild(btn);
        }
        screen.appendChild(list);
        const migration = document.createElement("div");
        migration.className = "seed-migration-panel";
        const migrationTitle = document.createElement("div");
        migrationTitle.className = "seed-migration-title";
        migrationTitle.textContent = `クリアseed移行・管理（端末内 ${opts.pendingSeedCount}件）`;
        migration.appendChild(migrationTitle);
        const migrationButtons = document.createElement("div");
        migrationButtons.className = "seed-migration-buttons";
        const exportBtn = document.createElement("button");
        exportBtn.className = "seed-tool-btn";
        exportBtn.textContent = "書き出し";
        exportBtn.disabled = opts.pendingSeedCount <= 0;
        exportBtn.addEventListener("click", handlers.onExportSeeds);
        migrationButtons.appendChild(exportBtn);
        const importBtn = document.createElement("button");
        importBtn.className = "seed-tool-btn";
        importBtn.textContent = "読み込み";
        importBtn.addEventListener("click", handlers.onImportSeeds);
        migrationButtons.appendChild(importBtn);
        const syncBtn = document.createElement("button");
        syncBtn.className = "seed-tool-btn";
        syncBtn.textContent = "サーバーへ送信";
        syncBtn.disabled = opts.pendingSeedCount <= 0;
        syncBtn.addEventListener("click", handlers.onSyncSeeds);
        migrationButtons.appendChild(syncBtn);
        migration.appendChild(migrationButtons);
        const migrationDesc = document.createElement("div");
        migrationDesc.className = "seed-migration-desc";
        migrationDesc.textContent = "書き出しでは削除されません。新しいGitHub Pagesで読み込んでからサーバーへ送信できます。";
        migration.appendChild(migrationDesc);
        screen.appendChild(migration);
        if (opts.statusText) {
            const status = document.createElement("div");
            status.className = "seed-sync-status";
            status.textContent = opts.statusText;
            screen.appendChild(status);
        }
        root.appendChild(screen);
        return;
    }
    const modeLabel = document.createElement("div");
    modeLabel.className = "menu-mode-label";
    const labels = { freecell: "フリーセル", klondike: "クロンダイク", spider: "スパイダー" };
    modeLabel.textContent = `モード: ${labels[pendingMode]}`;
    screen.appendChild(modeLabel);
    const guaranteeWrap = document.createElement("div");
    guaranteeWrap.className = "guarantee-wrap";
    const guaranteeBtn = document.createElement("button");
    guaranteeBtn.className = `guarantee-toggle ${opts.guaranteeEnabled ? "on" : "off"}`;
    guaranteeBtn.textContent = `クリア保証: ${opts.guaranteeEnabled ? "ON" : "OFF"}`;
    guaranteeBtn.disabled = !!opts.startBusy;
    guaranteeBtn.addEventListener("click", handlers.onToggleGuarantee);
    guaranteeWrap.appendChild(guaranteeBtn);
    const guaranteeDesc = document.createElement("div");
    guaranteeDesc.className = "guarantee-desc";
    guaranteeDesc.textContent = opts.guaranteeEnabled
        ? "実際にクリア済みのseedから開始します"
        : "通常のランダムseedで開始します";
    guaranteeWrap.appendChild(guaranteeDesc);
    screen.appendChild(guaranteeWrap);
    const levelList = document.createElement("div");
    levelList.className = "menu-list";
    for (const level of [1, 2, 3]) {
        const b = document.createElement("button");
        b.className = "menu-btn active";
        b.textContent = `レベル${level}`;
        b.disabled = !!opts.startBusy;
        b.addEventListener("click", () => handlers.onStartGame(pendingMode, level));
        levelList.appendChild(b);
    }
    screen.appendChild(levelList);
    if (opts.statusText) {
        const status = document.createElement("div");
        status.className = "seed-sync-status";
        status.textContent = opts.statusText;
        screen.appendChild(status);
    }
    if (opts.pendingSeedCount > 0) {
        const pending = document.createElement("div");
        pending.className = "seed-sync-note";
        pending.textContent = `未送信クリアseed: ${opts.pendingSeedCount}件`;
        screen.appendChild(pending);
    }
    const backBtn = document.createElement("button");
    backBtn.className = "menu-back-btn";
    backBtn.textContent = "← ゲーム選択に戻る";
    backBtn.disabled = !!opts.startBusy;
    backBtn.addEventListener("click", handlers.onBackModeSelect);
    screen.appendChild(backBtn);
    root.appendChild(screen);
}
