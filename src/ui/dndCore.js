// src/ui/dndCore.ts
// 汎用 Drag & Drop コア（UIフレーム共通）
// - レンダラは pointerdown で onDragStart(srcRef, ev) を呼ぶだけ
// - main側は createDnD(...) でコントローラを作り、handlers.onDragStart で startDrag を呼ぶ
// - ドロップ先は [data-drop="..."] を持つ要素をヒットテスト
function defaultHoverChange(prev, next) {
    if (prev?.el && prev.el.isConnected)
        prev.el.classList.remove("drop-hover");
    if (next?.el && next.el.isConnected)
        next.el.classList.add("drop-hover");
}
export function createDnD(opts) {
    const onHoverChange = opts.onHoverChange ?? (defaultHoverChange);
    // moving: ポインタがダウンしている (=ドラッグ候補)
    // dragging: 実際に「ドラッグ開始し、ゴースト表示中」
    let moving = false;
    let dragging = false;
    let ghost = null;
    let srcRefCurrent = null;
    let hover = null;
    let offsetX = opts.ghostOffset?.x ?? 0;
    let offsetY = opts.ghostOffset?.y ?? 0;
    let startX = 0;
    let startY = 0;
    let startEvForGhost = null;
    let activePointerId = null;
    const DRAG_THRESHOLD_SQ = 4 * 4; // 4px 以上動いたらドラッグ扱い
    const onPointerMove = (ev) => {
        if (!moving || !srcRefCurrent)
            return;
        if (activePointerId !== null && ev.pointerId !== activePointerId)
            return;
        // まだドラッグ開始していない → しきい値チェック
        if (!dragging) {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            if (dx * dx + dy * dy < DRAG_THRESHOLD_SQ) {
                return; // クリック扱い（ドラッグ未開始）
            }
            // ここで初めてドラッグ開始
            dragging = true;
            ghost = opts.buildGhost(srcRefCurrent, startEvForGhost);
            ghost.classList.add("drag-ghost");
            ghost.style.position = "fixed";
            ghost.style.left = "0";
            ghost.style.top = "0";
            ghost.style.pointerEvents = "none";
            // 初期位置も即反映（ちらつき防止）
            ghost.style.transform = `translate(${startX - offsetX}px, ${startY - offsetY}px)`;
            document.body.appendChild(ghost);
            document.body.classList.add("is-dragging");
        }
        if (ghost) {
            ghost.style.transform = `translate(${ev.clientX - offsetX}px, ${ev.clientY - offsetY}px)`;
        }
        const hit = opts.hitTestDest(ev.clientX, ev.clientY);
        if ((hit?.el ?? null) !== (hover?.el ?? null)) {
            onHoverChange(hover, hit);
            hover = hit;
        }
    };
    const finish = () => {
        moving = false;
        dragging = false;
        activePointerId = null;
        if (ghost && ghost.parentNode)
            ghost.parentNode.removeChild(ghost);
        ghost = null;
        onHoverChange(hover, null);
        hover = null;
        window.removeEventListener("pointermove", onPointerMove, true);
        window.removeEventListener("pointerup", onPointerUp, true);
        window.removeEventListener("keydown", onKeyDown, true);
        document.body.classList.remove("is-dragging");
        startEvForGhost = null;
    };
    const onPointerUp = (ev) => {
        if (!moving || !srcRefCurrent)
            return;
        if (activePointerId !== null && ev.pointerId !== activePointerId)
            return;
        const src = srcRefCurrent;
        srcRefCurrent = null;
        // ドラッグ開始していない → クリック扱い（DnD的には何もしない）
        if (!dragging) {
            finish();
            // onCancel は「ドラッグキャンセル」の意味なのでここでは呼ばない
            return;
        }
        const hit = opts.hitTestDest(ev.clientX, ev.clientY);
        if (hit && (!opts.canDrop || opts.canDrop(src, hit.dest))) {
            finish();
            opts.onDrop(src, hit.dest);
        }
        else {
            finish();
            opts.onCancel?.(src);
        }
    };
    const onKeyDown = (ev) => {
        if (!moving || !srcRefCurrent)
            return;
        if (ev.key === "Escape") {
            const src = srcRefCurrent;
            srcRefCurrent = null;
            finish();
            opts.onCancel?.(src);
        }
    };
    const startDrag = (src, startEv) => {
        if (moving)
            return; // 多重開始防止
        srcRefCurrent = src;
        moving = true;
        dragging = false;
        startX = startEv.clientX;
        startY = startEv.clientY;
        startEvForGhost = startEv;
        activePointerId = startEv.pointerId ?? null;
        // 可能ならキャプチャ（ウィンドウ外での取りこぼし対策）
        try {
            startEv.target?.setPointerCapture?.(startEv.pointerId);
        }
        catch { }
        window.addEventListener("pointermove", onPointerMove, true);
        window.addEventListener("pointerup", onPointerUp, true);
        window.addEventListener("keydown", onKeyDown, true);
    };
    const destroy = () => {
        if (moving && srcRefCurrent) {
            const src = srcRefCurrent;
            srcRefCurrent = null;
            finish();
            opts.onCancel?.(src);
        }
        else if (moving) {
            finish();
        }
    };
    return { startDrag, destroy };
}
/* ===== DOMユーティリティ（任意で使用可） ===== */
/** ポインタ位置の最前面要素から、祖先方向へ [data-drop] を探索 */
export function findDropElementAtPoint(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    if (!el)
        return null;
    return el.closest("[data-drop]");
}
/**
 * クリック位置＆ srcRef をもとに、
 * 「その束のうち、実際に動かす部分だけ」を複製してゴースト化
 *
 * - FreeCell: srcType === "column" | "freecell" | "foundation"
 * - Klondike: srcType === "tableau" | "waste" | "foundation"
 * - Spider:   srcType === "tableau"
 */
export function buildStackGhostFromClickedCard(src, startEv) {
    const root = document.createElement("div");
    root.style.position = "absolute";
    root.style.left = "0";
    root.style.top = "0";
    const makeDummy = () => {
        const dummy = document.createElement("div");
        dummy.className = "card back";
        root.appendChild(dummy);
        return root;
    };
    const target = startEv.target;
    // ===== FreeCell: column (columns-X) =====
    if (src && src.srcType === "column" && typeof src.colIndex === "number") {
        const colEl = document.querySelector(`[data-drop="column-${src.colIndex}"]`);
        if (!colEl)
            return makeDummy();
        const cards = Array.from(colEl.querySelectorAll(".card"));
        if (!cards.length)
            return makeDummy();
        const startIdx = Math.min(Math.max(src.startIndex ?? 0, 0), cards.length - 1);
        const startTop = cards[startIdx].offsetTop;
        for (let i = startIdx; i < cards.length; i++) {
            const c = cards[i];
            const clone = c.cloneNode(true);
            clone.style.transform = "none";
            clone.style.left = c.style.left || "0px";
            clone.style.top = `${c.offsetTop - startTop}px`;
            root.appendChild(clone);
        }
        return root;
    }
    // ===== FreeCell: freecell-N =====
    if (src && src.srcType === "freecell") {
        const slot = document.querySelector(`.freecell-slot-area[data-drop="freecell-${src.freecellIndex}"]`) || target?.closest(".freecell-slot-area");
        if (!slot)
            return makeDummy();
        const card = slot.querySelector(".card");
        if (!card)
            return makeDummy();
        const clone = card.cloneNode(true);
        clone.style.transform = "none";
        clone.style.left = "0px";
        clone.style.top = "0px";
        root.appendChild(clone);
        return root;
    }
    // ===== FreeCell / Klondike: foundation-N =====
    if (src && src.srcType === "foundation") {
        const idx = src.foundationIndex ?? 0;
        const slot = document.querySelector(`.foundation-slot-area[data-drop="foundation-${idx}"]`) || target?.closest(".foundation-slot-area");
        if (!slot)
            return makeDummy();
        const card = slot.querySelector(".card");
        if (!card)
            return makeDummy();
        const clone = card.cloneNode(true);
        clone.style.transform = "none";
        clone.style.left = "0px";
        clone.style.top = "0px";
        root.appendChild(clone);
        return root;
    }
    // ===== Klondike: waste（常に一番右端の1枚だけ） =====
    if (src && src.srcType === "waste") {
        const slot = target?.closest(".waste-slot") ||
            document.querySelector(".waste-slot");
        if (!slot)
            return makeDummy();
        const cards = Array.from(slot.querySelectorAll(".card"));
        const topCard = cards[cards.length - 1];
        if (!topCard)
            return makeDummy();
        const clone = topCard.cloneNode(true);
        clone.style.transform = "none";
        clone.style.left = "0px";
        clone.style.top = "0px";
        root.appendChild(clone);
        return root;
    }
    // ===== Klondike / Spider: tableau (tableau-X) =====
    if (src && src.srcType === "tableau" && typeof src.colIndex === "number") {
        const colEl = document.querySelector(`[data-drop="tableau-${src.colIndex}"]`) || target?.closest(".column-stack");
        if (!colEl)
            return makeDummy();
        const cards = Array.from(colEl.querySelectorAll(".card"));
        if (!cards.length)
            return makeDummy();
        const startIdx = Math.min(Math.max(src.cardIndex ?? 0, 0), cards.length - 1);
        const startTop = cards[startIdx].offsetTop;
        for (let i = startIdx; i < cards.length; i++) {
            const c = cards[i];
            const clone = c.cloneNode(true);
            clone.style.transform = "none";
            clone.style.left = c.style.left || "0px";
            clone.style.top = `${c.offsetTop - startTop}px`;
            root.appendChild(clone);
        }
        return root;
    }
    // ===== フォールバック：旧挙動（クリック位置から下にある .card だけ） =====
    if (!target)
        return makeDummy();
    const col = target.closest(".column-stack, .waste-slot, .freecell-slot-area, .foundation-slot-area");
    if (!col)
        return makeDummy();
    const clickedCard = target.closest(".card");
    const clickedTop = clickedCard ? clickedCard.offsetTop : 0;
    const cards = Array.from(col.querySelectorAll(".card"));
    for (const c of cards) {
        const top = c.offsetTop;
        if (top < clickedTop)
            continue;
        const clone = c.cloneNode(true);
        clone.style.transform = "none";
        clone.style.left = c.style.left || "0px";
        clone.style.top = `${top - clickedTop}px`;
        root.appendChild(clone);
    }
    if (!root.firstChild)
        return makeDummy();
    return root;
}
