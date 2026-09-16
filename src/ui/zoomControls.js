// src/ui/zoomControls.ts
//
// UNDO の右に「− / ％表示 / ＋」を挿入。
// 0.5〜2.0 の範囲を 0.05（= 5%）刻みで増減します。
// 値は localStorage に保存し、再読込後も維持されます。
// ★ 追加: 5% 変更ごとに 0.5 秒クールタイム（連打・ダブルタップ抑止）
// ★ 変更: クリックは使わず pointer 系に統一（重複発火防止）
// ★ 変更: トップバーの専用スロット #zoom-controls-slot を最優先で使用
// ★ 変更: 画面再描画で消えても MutationObserver を常駐させて自動再マウント
const MIN = 0.5;
const MAX = 2.0;
const STEP = 0.05; // 5% 刻み
const LS_KEY = "UserZoomMult";
const COOLDOWN_MS = 500; // クールタイム 0.5 秒
let lastStepAt = 0; // 直近で 5% 変更した時刻
function clamp(v) {
    return Math.max(MIN, Math.min(MAX, v));
}
function quantize(v) {
    // STEP 単位へスナップ（浮動小数誤差を抑えるため toFixed(3)）
    const snapped = Math.round(v / STEP) * STEP;
    return Number(snapped.toFixed(3));
}
function getCurrentMult() {
    // 1) CSS 変数
    const cs = getComputedStyle(document.documentElement);
    const raw = cs.getPropertyValue("--user-zoom-mult").trim();
    let fromCss = Number.parseFloat(raw || "1");
    if (!Number.isFinite(fromCss) || fromCss <= 0)
        fromCss = 1;
    // 2) localStorage（優先）
    try {
        const s = localStorage.getItem(LS_KEY);
        if (s) {
            const v = Number.parseFloat(s);
            if (Number.isFinite(v))
                return clamp(v);
        }
    }
    catch {
        // ignore
    }
    return clamp(fromCss);
}
function setMult(mult) {
    const v = quantize(clamp(mult));
    const root = document.documentElement.style;
    root.setProperty("--user-zoom-mult", String(v));
    try {
        localStorage.setItem(LS_KEY, String(v));
    }
    catch {
        // ignore
    }
    // スケール再計算を促す
    requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"));
    });
}
function makeEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className)
        el.className = className;
    if (text != null)
        el.textContent = text;
    return el;
}
function buildControls() {
    const wrap = makeEl("div", "zoom-controls");
    wrap.setAttribute("data-zoom-controls", "true");
    const btnMinus = makeEl("button", "zoom-btn zoom-minus", "−");
    btnMinus.type = "button";
    btnMinus.title = "縮小（−5%）";
    const label = makeEl("span", "zoom-label");
    label.title = "現在のズーム倍率";
    const btnPlus = makeEl("button", "zoom-btn zoom-plus", "＋");
    btnPlus.type = "button";
    btnPlus.title = "拡大（＋5%）";
    const updateLabel = () => {
        // 5% 単位での安定表示（mult*20 を四捨五入し ×5）
        const pct = Math.round(getCurrentMult() * 20) * 5;
        label.textContent = `${pct}%`;
    };
    updateLabel();
    // クールタイム付き 5% ステップ実行
    const tryStep = (delta) => {
        const now = performance.now();
        if (now - lastStepAt < COOLDOWN_MS)
            return; // クール中は無視
        setMult(getCurrentMult() + delta);
        lastStepAt = now;
        updateLabel();
    };
    // pointer イベントで長押し対応（click は使わない）
    const installRepeater = (btn, delta) => {
        let intervalId = null;
        const start = (ev) => {
            ev.preventDefault(); // click への昇格抑止
            btn.setPointerCapture?.(ev.pointerId);
            // 押下時に 1 回
            tryStep(delta);
            // 押し続けている間は COOLDOWN_MS ごとに 1 回だけ進む
            if (intervalId == null) {
                intervalId = window.setInterval(() => tryStep(delta), COOLDOWN_MS);
            }
        };
        const stop = (ev) => {
            if (ev)
                btn.releasePointerCapture?.(ev.pointerId);
            if (intervalId != null) {
                clearInterval(intervalId);
                intervalId = null;
            }
        };
        btn.addEventListener("pointerdown", start);
        btn.addEventListener("pointerup", stop);
        btn.addEventListener("pointercancel", stop);
        btn.addEventListener("pointerleave", stop);
        window.addEventListener("blur", () => stop());
    };
    installRepeater(btnMinus, -STEP);
    installRepeater(btnPlus, +STEP);
    // 並び: [−][%][＋]
    wrap.appendChild(btnMinus);
    wrap.appendChild(label);
    wrap.appendChild(btnPlus);
    return wrap;
}
function findZoomSlot() {
    return document.getElementById("zoom-controls-slot");
}
function findUndoButton() {
    let btn = document.querySelector('button[data-btn="undo"], button[data-action="undo"]');
    if (btn)
        return btn;
    btn = document.querySelector("button.undo-btn, #undo-btn, #btn-undo");
    if (btn)
        return btn;
    const candidates = Array.from(document.querySelectorAll("button"));
    for (const b of candidates) {
        const t = (b.textContent || "").trim();
        const u = t.toUpperCase();
        if (u === "UNDO" || u.includes("UNDO") || t.includes("戻す") || t.includes("取り消し")) {
            return b;
        }
    }
    return null;
}
function mountOnce() {
    // 既に存在していれば何もしない
    if (document.querySelector('[data-zoom-controls="true"]')) {
        return { mounted: true };
    }
    const controls = buildControls();
    // ★ 最優先：専用スロットへ固定
    const slot = findZoomSlot();
    if (slot) {
        // 念のため重複を防ぐ
        const old = slot.querySelector('[data-zoom-controls="true"]');
        if (old)
            old.remove();
        slot.appendChild(controls);
        return { mounted: true };
    }
    // フォールバック：UNDO の直後
    const undo = findUndoButton();
    if (undo && undo.parentElement) {
        undo.insertAdjacentElement("afterend", controls);
        return { mounted: true };
    }
    // さらにフォールバック：それっぽいコンテナ
    const fallbacks = [
        "#header-actions",
        ".header-actions",
        "#top-controls",
        ".top-controls",
        "#hud-actions",
        ".hud-actions",
    ];
    for (const sel of fallbacks) {
        const host = document.querySelector(sel);
        if (host) {
            host.appendChild(controls);
            return { mounted: true };
        }
    }
    return { mounted: false };
}
function ensureInitialVar() {
    const cs = getComputedStyle(document.documentElement);
    if (!cs.getPropertyValue("--user-zoom-mult")) {
        document.documentElement.style.setProperty("--user-zoom-mult", "1");
    }
    setMult(getCurrentMult()); // 量子化して反映
}
function watchForUndoAndMount() {
    // 初回トライ
    mountOnce();
    // 常駐で監視（再描画で外れても自動復帰）
    const obs = new MutationObserver(() => {
        // slot が新しく生まれたり、既存コントロールが消えたら再マウント
        if (!document.querySelector('[data-zoom-controls="true"]')) {
            mountOnce();
        }
        else {
            // 既にあるが slot ができたら移設
            const slot = findZoomSlot();
            const ctrl = document.querySelector('[data-zoom-controls="true"]');
            if (slot && ctrl && ctrl.parentElement !== slot) {
                slot.innerHTML = "";
                slot.appendChild(ctrl);
            }
        }
    });
    obs.observe(document.body, { childList: true, subtree: true });
}
export const ZoomControls = {
    start() {
        ensureInitialVar();
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () => {
                setTimeout(watchForUndoAndMount, 0);
            });
        }
        else {
            setTimeout(watchForUndoAndMount, 0);
        }
    }
};
