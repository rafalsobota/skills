// Shared diagram-review overlay — Figma-style pins on infinite canvas.
// CLASSIC script (not a module) so it loads from file:// without CORS issues.
(function () {
  if (typeof document === "undefined") return;

  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    if (props) for (const k in props) {
      const v = props[k];
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v != null) n.setAttribute(k, v);
    }
    for (const kid of kids) if (kid != null) n.append(kid);
    return n;
  }

  function buildFeedbackMarkdown(meta, overall, items) {
    const header = `## Feedback on diagram ${meta.version} (file: ${meta.file})`;
    const o = String(overall || "").trim();
    const live = items.filter(i => String(i.text).trim());
    const parts = [header];
    if (o) parts.push("> " + o.replace(/\n/g, "\n> "));
    if (live.length) parts.push(live.map(i => `- **[element: ${i.target}]** ${String(i.text).trim()}`).join("\n"));
    if (parts.length === 1) return `${header}\n\n_(no comments)_\n`;
    return parts.join("\n\n") + "\n";
  }

  function injectStyles() {
    const css = `
    :root {
      --dr-font: 'Inter', system-ui, -apple-system, sans-serif;
      --dr-text: #18181b; --dr-text-soft: #52525b; --dr-text-faint: #a1a1aa;
      --dr-border: rgba(9,9,11,.08); --dr-border-strong: rgba(9,9,11,.13);
      --dr-bg: #ffffff; --dr-bg-subtle: rgba(9,9,11,.03);
      --dr-accent: #2563eb; --dr-accent-press: #1d4ed8;
      --dr-pin: #18181b;
      --dr-card-shadow: 0 0 0 1px rgba(0,0,0,.06), 0 4px 8px rgba(0,0,0,.05), 0 16px 40px rgba(0,0,0,.1);
      --dr-panel-shadow: 0 0 0 1px rgba(0,0,0,.07), 0 4px 16px rgba(0,0,0,.07), 0 16px 48px rgba(0,0,0,.1);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --dr-text: #f4f4f5; --dr-text-soft: #a1a1aa; --dr-text-faint: #71717a;
        --dr-border: rgba(255,255,255,.09); --dr-border-strong: rgba(255,255,255,.15);
        --dr-bg: #18181b; --dr-bg-subtle: rgba(255,255,255,.04);
        --dr-pin: #e4e4e7;
        --dr-card-shadow: 0 0 0 1px rgba(255,255,255,.07), 0 4px 8px rgba(0,0,0,.3), 0 16px 40px rgba(0,0,0,.45);
        --dr-panel-shadow: 0 0 0 1px rgba(255,255,255,.07), 0 4px 16px rgba(0,0,0,.3), 0 16px 48px rgba(0,0,0,.4);
      }
    }

    /* ── Layout ── */
    body { margin: 0; overflow: hidden; background: #f0efed; font-family: var(--dr-font); -webkit-font-smoothing: antialiased; }
    #dr-viewport { position: fixed; inset: 0; overflow: hidden; }
    #dr-viewport.dr-panning { cursor: grabbing; }
    #dr-canvas { position: absolute; top: 0; left: 0; transform-origin: 0 0; }
    #stage { padding: 80px; box-sizing: border-box; }
    #stage svg { display: block; max-width: none; }

    /* ── SVG element hover — neutral ── */
    .dr-target { cursor: pointer; transition: filter .15s; }
    .dr-target:hover { filter: drop-shadow(0 0 5px rgba(0,0,0,.2)); }
    .dr-target.dr-active { filter: drop-shadow(0 0 7px rgba(0,0,0,.3)); }

    /* ── Teardrop comment ── */
    .dr-comment { position: fixed; z-index: 1000; display: flex; flex-direction: column; align-items: flex-start; cursor: pointer; }

    /* Closed pin — white balloon, sharp at bottom-left, dark circle inside with number */
    .dr-comment-closed { position: relative; width: 28px; height: 28px; flex-shrink: 0; }
    .dr-comment-pin-shape {
      width: 28px; height: 28px;
      border-radius: 50% 50% 50% 0;  /* very round — Figma style */
      background: #fff;
      box-shadow: 0 2px 8px rgba(0,0,0,.22), 0 0 0 1px rgba(0,0,0,.06);
      position: relative;
    }
    /* Inner circle with number — reused in open card too */
    .dr-pin-badge {
      position: absolute; inset: 5px; border-radius: 50%;
      background: #18181b; color: #fff;
      font: 700 10px/1 var(--dr-font);
      display: flex; align-items: center; justify-content: center;
      pointer-events: none; flex-shrink: 0;
    }
    .dr-comment-closed[hidden] { display: none; }

    /* Open card — sharp bottom-left corner = anchor. Badge + label in head row. */
    .dr-comment-open { width: 260px; background: var(--dr-bg); border-radius: 12px 12px 12px 0; padding: 12px 14px; box-shadow: var(--dr-card-shadow); cursor: default; position: relative; }
    .dr-comment-open[hidden] { display: none; }
    .dr-comment-open-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .dr-comment-open-head .dr-pin-badge { position: static; inset: auto; width: 20px; height: 20px; flex-shrink: 0; }
    .dr-pin-badge-drag { cursor: grab; }
    .dr-pin-badge-drag:active { cursor: grabbing; }

    .dr-pin-label { font: 500 12px/1.3 var(--dr-font); color: var(--dr-text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 8px; }
    .dr-pin-ta { display: block; width: 100%; box-sizing: border-box; border: none; outline: none; background: transparent; resize: none; overflow: hidden; min-height: 20px; max-height: 40vh; font: 400 14px/1.5 var(--dr-font); color: var(--dr-text); cursor: text; padding: 0; }
    .dr-pin-ta::placeholder { color: var(--dr-text-faint); }

    /* ── Floating panel — clean white ── */
    #dr-panel { position: fixed; bottom: 68px; right: 16px; width: 316px; max-height: 72vh; overflow: hidden; display: flex; flex-direction: column; background: var(--dr-bg); border: 1px solid var(--dr-border); border-radius: 16px; box-shadow: var(--dr-panel-shadow); z-index: 2000; font-family: var(--dr-font); }
    #dr-panel[hidden] { display: none; }

    .dr-panel-head { display: flex; align-items: center; padding: 14px 16px 12px; border-bottom: 1px solid var(--dr-border); flex-shrink: 0; gap: 8px; }
    .dr-panel-title { font: 600 14px/1 var(--dr-font); flex: 1; color: var(--dr-text); letter-spacing: -.01em; }
    .dr-panel-close { border: none; background: transparent; color: var(--dr-text-faint); cursor: pointer; font-size: 18px; line-height: 1; padding: 2px 5px; border-radius: 6px; }
    .dr-panel-close:hover { background: var(--dr-bg-subtle); color: var(--dr-text); }

    .dr-panel-body { flex: 1; overflow-y: auto; }

    .dr-overall { padding: 10px 14px 12px; border-bottom: 1px solid var(--dr-border); }
    .dr-overall-input { display: block; width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--dr-border); border-radius: 8px; background: var(--dr-bg-subtle); color: var(--dr-text); font: 400 14px/1.45 var(--dr-font); resize: none; overflow: hidden; min-height: 64px; }
    .dr-overall-input::placeholder { color: var(--dr-text-faint); }
    .dr-overall-input:focus { outline: 2px solid var(--dr-accent); outline-offset: -1px; border-color: transparent; }

    .dr-list-head { display: flex; align-items: center; gap: 6px; padding: 10px 14px 4px; }
    .dr-list-title { font: 500 12px/1 var(--dr-font); color: var(--dr-text-soft); flex: 1; }
    .dr-list-count { background: var(--dr-bg-subtle); border-radius: 999px; padding: 1px 7px; font: 500 11px/18px var(--dr-font); color: var(--dr-text-soft); }
    .dr-list { padding: 4px 6px 8px; display: flex; flex-direction: column; gap: 6px; }

    .dr-row { display: flex; align-items: flex-start; gap: 8px; padding: 9px 10px; border-radius: 8px; cursor: default; }
    .dr-row:hover { background: var(--dr-bg-subtle); }
    .dr-row.dr-row-active { border-left: 3px solid var(--dr-accent); padding-left: 7px; }
    .dr-row-body { min-width: 0; flex: 1; }
    .dr-row-label { font: 500 12px/1.3 var(--dr-font); color: var(--dr-text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 2px; }
    .dr-row-del { border: 0; background: transparent; color: var(--dr-text-faint); cursor: pointer; font-size: 13px; padding: 2px 3px; border-radius: 4px; flex: 0 0 auto; opacity: 0; align-self: flex-start; margin-top: 1px; }
    .dr-row:hover .dr-row-del, .dr-row:focus-within .dr-row-del { opacity: 1; }
    .dr-row-del:hover { background: var(--dr-border); color: var(--dr-text); }
    .dr-row-ta { display: block; width: 100%; box-sizing: border-box; border: none; outline: none; background: transparent; resize: none; overflow: hidden; min-height: 18px; font: 400 13px/1.5 var(--dr-font); color: var(--dr-text); cursor: default; padding: 0; }
    .dr-row-ta:focus { cursor: text; }
    .dr-row-ta::placeholder { color: var(--dr-text-faint); }
    .dr-badge { flex: 0 0 auto; width: 18px; height: 18px; border-radius: 50%; background: var(--dr-text); color: #fff; font: 700 10px/18px var(--dr-font); text-align: center; }
    .dr-empty { padding: 20px 16px; text-align: center; color: var(--dr-text-faint); }
    .dr-empty-title { font: 600 13px/1 var(--dr-font); color: var(--dr-text-soft); }
    .dr-empty-body { margin-top: 6px; font-size: 12px; line-height: 1.5; }

    .dr-panel-foot { padding: 12px; border-top: 1px solid var(--dr-border); flex-shrink: 0; position: relative; }
    /* Split button: main copy action + caret to reveal raw text */
    .dr-btn-split { display: flex; gap: 0; }
    .dr-btn { padding: 10px 12px; border-radius: 10px; border: 1px solid var(--dr-accent); background: var(--dr-accent); color: #fff; font: 600 13px/1 var(--dr-font); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
    .dr-btn:hover { background: var(--dr-accent-press); }
    .dr-btn:focus-visible { outline: 2px solid var(--dr-accent); outline-offset: 2px; }
    .dr-btn:disabled { opacity: .5; cursor: default; }
    .dr-btn-split .dr-btn { flex: 1; border-radius: 10px 0 0 10px; border-right-color: rgba(255,255,255,.28); }
    .dr-caret-btn { width: 40px; flex: 0 0 auto; border: 1px solid var(--dr-accent); border-left: none; border-radius: 0 10px 10px 0; background: var(--dr-accent); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; }
    .dr-caret-btn:hover { background: var(--dr-accent-press); }
    .dr-caret-btn:disabled { opacity: .5; cursor: default; }
    .dr-caret-btn svg { transition: transform .2s; }
    .dr-caret-btn.dr-open svg { transform: rotate(180deg); }

    .dr-preview { position: absolute; left: 12px; right: 12px; bottom: calc(100% + 8px); max-height: 52vh; overflow: auto; background: var(--dr-bg); border: 1px solid var(--dr-border-strong); border-radius: 10px; box-shadow: 0 4px 20px rgba(9,9,11,.1); padding: 10px 12px; }
    .dr-preview[hidden] { display: none; }
    .dr-preview-label { font: 600 11px/1 var(--dr-font); color: var(--dr-text-faint); margin-bottom: 6px; user-select: none; -webkit-user-select: none; }
    .dr-preview-pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 400 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--dr-text); }

    /* ── Trigger pill ── */
    #dr-trigger { position: fixed; bottom: 16px; right: 16px; height: 40px; padding: 0 14px; border-radius: 20px; background: var(--dr-bg); border: 1px solid var(--dr-border); box-shadow: 0 1px 4px rgba(0,0,0,.06), 0 4px 16px rgba(0,0,0,.08); font: 500 13px/1 var(--dr-font); color: var(--dr-text); cursor: pointer; z-index: 2001; display: flex; align-items: center; gap: 8px; }
    #dr-trigger:hover { box-shadow: 0 2px 8px rgba(0,0,0,.1), 0 6px 20px rgba(0,0,0,.1); }
    .dr-trigger-count { background: var(--dr-text); color: #fff; border-radius: 999px; padding: 1px 6px; font: 600 11px/16px var(--dr-font); min-width: 16px; text-align: center; }
    .dr-trigger-count:empty { display: none; }

    /* ── Toast ── */
    .dr-toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%) translateY(8px); background: #18181b; color: #fafafa; padding: 10px 14px; border-radius: 8px; font: 400 13px/1 var(--dr-font); box-shadow: 0 4px 20px rgba(0,0,0,.2); opacity: 0; transition: opacity .2s, transform .2s; z-index: 3000; display: flex; align-items: center; gap: 12px; }
    .dr-toast.dr-show { opacity: 1; transform: translateX(-50%) translateY(0); }`;
    document.head.append(el("style", { text: css }));
  }

  function autoGrow(ta) {
    ta.style.height = "auto";
    const max = parseFloat(getComputedStyle(ta).maxHeight); // NaN if "none"
    const sh = ta.scrollHeight;
    ta.style.height = (max && sh > max ? max : sh) + "px";
    ta.style.overflowY = (max && sh > max) ? "auto" : "hidden";
  }

  // Chevron-down icon (DOM, no innerHTML)
  function makeChevron() {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", "12"); svg.setAttribute("height", "12");
    svg.setAttribute("viewBox", "0 0 12 12"); svg.setAttribute("fill", "none");
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", "M2.5 4.5L6 8L9.5 4.5");
    p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "1.6");
    p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round");
    svg.appendChild(p);
    return svg;
  }

  function formatLabel(id) {
    return id.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase()).substring(0, 32);
  }

  function injectFonts() {
    const pc = document.createElement("link"); pc.rel = "preconnect"; pc.href = "https://fonts.googleapis.com"; document.head.append(pc);
    const f = document.createElement("link"); f.rel = "stylesheet"; f.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"; document.head.append(f);
  }

  function setupCanvas(onTransform) {
    const stage = document.getElementById("stage");
    if (!stage) return () => ({ tx: 0, ty: 0, scale: 1 });
    const viewport = el("div", { id: "dr-viewport" });
    const canvas = el("div", { id: "dr-canvas" });
    stage.parentNode.insertBefore(viewport, stage);
    viewport.appendChild(canvas);
    canvas.appendChild(stage);

    let tx = 0, ty = 0, scale = 1, panning = false, ps = null;

    function apply() {
      canvas.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
      onTransform();
    }

    function center() {
      // Reset to scale 1, centered. Measure stage in unscaled space first.
      scale = 1;
      canvas.style.transform = "translate(0px,0px) scale(1)";
      const r = stage.getBoundingClientRect();
      tx = (window.innerWidth  - r.width)  / 2;
      ty = (window.innerHeight - r.height) / 2;
      apply();
    }
    requestAnimationFrame(center);

    viewport.addEventListener("mousedown", e => {
      if (e.target.closest("[data-id], .dr-comment, #dr-panel, #dr-trigger")) return;
      e.preventDefault();
      panning = true; ps = { sx: e.clientX - tx, sy: e.clientY - ty };
      viewport.classList.add("dr-panning");
    });
    // Double-click empty canvas → reset zoom & pan
    viewport.addEventListener("dblclick", e => {
      if (e.target.closest("[data-id], .dr-comment, #dr-panel, #dr-trigger")) return;
      center();
    });
    document.addEventListener("mousemove", e => {
      if (!panning || !ps) return;
      tx = e.clientX - ps.sx; ty = e.clientY - ps.sy; apply();
    });
    document.addEventListener("mouseup", () => { panning = false; ps = null; viewport.classList.remove("dr-panning"); });

    viewport.addEventListener("wheel", e => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const ns = Math.max(0.1, Math.min(8, scale * (e.deltaY < 0 ? 1.08 : 0.92)));
        tx = e.clientX - (e.clientX - tx) * (ns / scale);
        ty = e.clientY - (e.clientY - ty) * (ns / scale);
        scale = ns;
      } else {
        tx -= e.deltaX; ty -= e.deltaY;
      }
      apply();
    }, { passive: false });

    // Expose current transform state for layout calculations
    return () => ({ tx, ty, scale });
  }

  function init() {
    const meta = window.diagramMeta || { version: "v?", file: "" };
    let seq = 0, overall = "", openItem = null;
    const items = [];

    injectFonts();
    injectStyles();
    const getTransform = setupCanvas(layoutComments);

    // Cache SVG element positions in canvas-local coordinates.
    // Computed once per renderComments(); zoom/pan reuses the cache with pure math.
    const nodePositions = new Map(); // data-id → { right, top, cx, cy, anchor }
    let positionsDirty = true;

    function cachePositions() {
      const { tx, ty, scale } = getTransform();
      nodePositions.clear();
      for (const node of document.querySelectorAll("[data-id]")) {
        const r = node.getBoundingClientRect();
        // Fallback anchor (used only if an item has no explicit click point): groups (edges)
        // center on their midpoint, shapes (nodes) sit at the top-right corner.
        let anchor = node.getAttribute("data-anchor");
        if (anchor !== "center" && anchor !== "corner") {
          anchor = node.tagName.toLowerCase() === "g" ? "center" : "corner";
        }
        nodePositions.set(node.getAttribute("data-id"), {
          left:   (r.left  - tx) / scale,
          top:    (r.top   - ty) / scale,
          right:  (r.right - tx) / scale,
          bottom: (r.bottom- ty) / scale,
          cx:     (r.left + r.width  / 2 - tx) / scale,
          cy:     (r.top  + r.height / 2 - ty) / scale,
          anchor,
        });
      }
      positionsDirty = false;
    }

    // Convert a viewport click to a canvas-local anchor point, clamped to the element's
    // clickable bounds — the pin is placed exactly where the user clicked.
    function clickAnchor(target, clientX, clientY) {
      const { tx, ty, scale } = getTransform();
      const node = document.querySelector(`[data-id="${CSS.escape(target)}"]`);
      if (!node) return null;
      const r = node.getBoundingClientRect();
      const cx = Math.max(r.left, Math.min(clientX, r.right));
      const cy = Math.max(r.top,  Math.min(clientY, r.bottom));
      return { x: (cx - tx) / scale, y: (cy - ty) / scale };
    }

    // ── Panel ──
    const overallInput = el("textarea", { class: "dr-overall-input", rows: "1", placeholder: "Add overall notes…", "aria-label": "Whole-diagram comment" });
    const listCountEl = el("span", { class: "dr-list-count" });
    const listEl = el("div", { class: "dr-list", role: "list" });
    const copyBtn = el("button", { class: "dr-btn", type: "button", disabled: "", text: "Copy for AI" });
    const caretBtn = el("button", { class: "dr-caret-btn", type: "button", disabled: "", title: "Show raw text", "aria-label": "Show raw text" }, makeChevron());
    const previewPre = el("pre", { class: "dr-preview-pre" });
    const previewPop = el("div", { class: "dr-preview", hidden: "" }, el("div", { class: "dr-preview-label", text: "This is what gets copied — paste into any AI agent" }), previewPre);
    const panel = el("div", { id: "dr-panel", hidden: "" },
      el("div", { class: "dr-panel-head" },
        el("span", { class: "dr-panel-title", text: "Review" }),
        el("button", { class: "dr-panel-close", type: "button", "aria-label": "Close", text: "×",
          onClick: (e) => { e.stopPropagation(); panel.hidden = true; } })),
      el("div", { class: "dr-panel-body" },
        el("div", { class: "dr-overall" }, overallInput),
        el("div", { class: "dr-list-head" }, el("span", { class: "dr-list-title", text: "Comments" }), listCountEl),
        listEl),
      el("div", { class: "dr-panel-foot" }, previewPop,
        el("div", { class: "dr-btn-split" }, copyBtn, caretBtn)));
    const triggerCount = el("span", { class: "dr-trigger-count" });
    const trigger = el("button", { id: "dr-trigger", type: "button", "aria-label": "Open review panel",
      onClick: (e) => { e.stopPropagation(); panel.hidden ? showPanel() : (panel.hidden = true); } },
      el("span", { text: "Review" }), triggerCount);

    // Grow all panel textareas — only works once they're visible (scrollHeight needs layout)
    function growAllRows() {
      requestAnimationFrame(() => {
        autoGrow(overallInput);
        for (const ta of listEl.querySelectorAll(".dr-row-ta")) autoGrow(ta);
      });
    }
    function showPanel() { panel.hidden = false; growAllRows(); }

    const liveCount = () => (overall.trim() ? 1 : 0) + items.filter(i => String(i.text).trim()).length;

    function updateCounts() {
      listCountEl.textContent = items.length ? String(items.length) : "";
      const n = liveCount();
      copyBtn.disabled = n === 0;
      caretBtn.disabled = n === 0;
      if (n === 0 && !previewPop.hidden) { previewPop.hidden = true; caretBtn.classList.remove("dr-open"); }
      triggerCount.textContent = n ? String(n) : "";
    }

    // ── Layout — pure math, no getBoundingClientRect during zoom/pan ──
    function layoutComment(commentEl) {
      if (positionsDirty) cachePositions();
      const { tx, ty, scale } = getTransform();
      const cached = nodePositions.get(commentEl.dataset.target);
      if (!cached) { commentEl.style.display = "none"; return; }
      commentEl.style.display = "";

      // The teardrop tip (sharp bottom-left corner) anchors to a point that is ON the
      // element, so closed pin and open card share the exact tip → pin morphs in place.
      //   • per-item anchor: the exact point the user clicked (or dragged the pin to)
      //   • fallback corner (nodes): top-right corner, dipping OVER by `bite` px
      //   • fallback center (edges): bbox center = midpoint of a straight line
      // canvas-local → viewport: pure arithmetic, pixel-perfect at any zoom level.
      const item = items.find(i => i.target === commentEl.dataset.target);
      let tipX, tipY;
      if (item && item.anchor) {
        tipX = tx + item.anchor.x * scale;
        tipY = ty + item.anchor.y * scale;
      } else if (cached.anchor === "center") {
        tipX = tx + cached.cx * scale;
        tipY = ty + cached.cy * scale;
      } else {
        const bite = 5;
        tipX = tx + cached.right * scale - bite;
        tipY = ty + cached.top   * scale + bite;
      }

      // Container's bottom-left corner IS the tip → left = tipX, top = tipY - height.
      commentEl.style.left = tipX + "px";
      const isOpen = !commentEl.querySelector(".dr-comment-open").hidden;
      const h = isOpen ? (commentEl.querySelector(".dr-comment-open").offsetHeight || 80) : 28;
      commentEl.style.top = (tipY - h) + "px";
    }

    function layoutComments() {
      for (const c of document.querySelectorAll(".dr-comment")) layoutComment(c);
    }

    // ── Open / close ──
    function openComment(item, focusAfter = false) {
      if (openItem && openItem !== item) closeComment();
      openItem = item;
      const node = document.querySelector(`[data-id="${CSS.escape(item.target)}"]`);
      if (node) node.classList.add("dr-active");
      for (const row of listEl.querySelectorAll(".dr-row"))
        row.classList.toggle("dr-row-active", row.dataset.target === item.target);
      const commentEl = document.querySelector(`.dr-comment[data-target="${CSS.escape(item.target)}"]`);
      if (!commentEl) return;
      commentEl.style.zIndex = "1001"; // open card on top of other closed pins
      commentEl.querySelector(".dr-comment-closed").hidden = true;
      commentEl.querySelector(".dr-comment-open").hidden = false;
      requestAnimationFrame(() => {
        const ta = commentEl.querySelector(".dr-pin-ta");
        // Grow textarea to fit content BEFORE measuring card height for layout
        if (ta) autoGrow(ta);
        layoutComment(commentEl);
        if (focusAfter && ta) { ta.focus(); const l = ta.value.length; ta.setSelectionRange(l, l); }
      });
    }

    function closeComment() {
      if (!openItem) return;
      const node = document.querySelector(`[data-id="${CSS.escape(openItem.target)}"]`);
      if (node) node.classList.remove("dr-active");
      for (const row of listEl.querySelectorAll(".dr-row-active")) row.classList.remove("dr-row-active");
      const commentEl = document.querySelector(`.dr-comment[data-target="${CSS.escape(openItem.target)}"]`);
      if (commentEl) {
        commentEl.style.zIndex = "";
        commentEl.querySelector(".dr-comment-closed").hidden = false;
        commentEl.querySelector(".dr-comment-open").hidden  = true;
        requestAnimationFrame(() => layoutComment(commentEl));
      }
      openItem = null;
    }

    function syncCardTa(item) {
      const commentEl = document.querySelector(`.dr-comment[data-target="${CSS.escape(item.target)}"]`);
      const ta = commentEl?.querySelector(".dr-pin-ta");
      if (ta && ta !== document.activeElement) { ta.value = item.text; autoGrow(ta); }
    }

    // ── State ──
    function addOrEditElement(target, clientX, clientY) {
      let item = items.find(i => i.target === target);
      if (!item) {
        item = { id: ++seq, target, text: "" };
        // Place the pin exactly where the user clicked (clamped to the element).
        if (clientX != null) item.anchor = clickAnchor(target, clientX, clientY);
        items.push(item); renderList(); renderComments();
      }
      openComment(item, true);
    }

    function deleteItem(item) {
      const i = items.indexOf(item);
      if (i >= 0) items.splice(i, 1);
      if (openItem === item) openItem = null;
      const node = document.querySelector(`[data-id="${CSS.escape(item.target)}"]`);
      if (node) node.classList.remove("dr-active");
      renderList(); renderComments(); updatePreview();
    }

    // ── Render panel list ──
    function renderList() {
      listEl.replaceChildren();
      if (!items.length) {
        listEl.append(el("div", { class: "dr-empty" },
          el("div", { class: "dr-empty-title", text: "No comments yet" }),
          el("div", { class: "dr-empty-body", text: "Click any element in the diagram to add a comment." })));
      } else {
        items.forEach((item, i) => {
          const rowTa = el("textarea", { class: "dr-row-ta", rows: "1", placeholder: "Add a comment…", "aria-label": "Element comment" });
          rowTa.value = item.text;
          rowTa.addEventListener("input", () => { item.text = rowTa.value; autoGrow(rowTa); syncCardTa(item); updatePreview(); updateCounts(); });
          rowTa.addEventListener("blur", () => { if (!String(item.text).trim()) deleteItem(item); });
          rowTa.addEventListener("keydown", e => { if (e.key === "Escape") { e.preventDefault(); rowTa.blur(); } });
          autoGrow(rowTa);
          const rowDel = el("button", { class: "dr-row-del", type: "button", "aria-label": "Delete", text: "×",
            onClick: (e) => { e.stopPropagation(); deleteItem(item); } });
          const row = el("div", { class: "dr-row", role: "listitem" },
            el("span", { class: "dr-badge", text: String(i + 1) }),
            el("div", { class: "dr-row-body" }, el("div", { class: "dr-row-label", text: formatLabel(item.target) }), rowTa),
            rowDel);
          row.dataset.target = item.target;
          listEl.append(row);
        });
      }
      updateCounts();
      if (openItem) {
        for (const row of listEl.querySelectorAll(".dr-row"))
          row.classList.toggle("dr-row-active", row.dataset.target === openItem.target);
      }
      if (!panel.hidden) growAllRows(); // rows just rebuilt — re-grow if panel is visible
    }

    // ── Render comment pins ──
    function renderComments() {
      for (const c of document.querySelectorAll(".dr-comment")) c.remove();
      positionsDirty = true; // SVG state may have changed — refresh cache before next layout
      const prevOpen = openItem?.target;

      items.forEach((item, i) => {
        const pinTa = el("textarea", { class: "dr-pin-ta", rows: "1", placeholder: "Add a comment…", "aria-label": "Element comment" });
        pinTa.value = item.text;
        pinTa.addEventListener("input", () => {
          item.text = pinTa.value; autoGrow(pinTa); renderList(); updatePreview();
          const c = pinTa.closest(".dr-comment"); if (c) layoutComment(c);
        });
        let hideTimer = null;
        pinTa.addEventListener("blur", () => {
          if (!String(item.text).trim()) { deleteItem(item); return; }
          // Only close if THIS comment is still the open one — guards against a stale
          // blur (fired when the card is rebuilt) closing a newly-opened comment.
          hideTimer = setTimeout(() => { if (openItem === item) closeComment(); }, 200);
        });
        pinTa.addEventListener("keydown", e => { if (e.key === "Escape") { e.preventDefault(); closeComment(); } });
        pinTa.addEventListener("click", e => e.stopPropagation());
        autoGrow(pinTa);

        const num = String(i + 1);
        const openBadge = el("span", { class: "dr-pin-badge dr-pin-badge-drag", title: "Drag to move", text: num });
        const openEl = el("div", { class: "dr-comment-open", hidden: "" },
          el("div", { class: "dr-comment-open-head" },
            openBadge,
            el("span", { class: "dr-pin-label", text: formatLabel(item.target) })),
          pinTa);
        openEl.addEventListener("click", e => e.stopPropagation());

        const pinShape = el("div", { class: "dr-comment-pin-shape" },
          el("span", { class: "dr-pin-badge", text: num }));
        const closedEl = el("div", { class: "dr-comment-closed" }, pinShape);

        const commentEl = el("div", { class: "dr-comment" }, openEl, closedEl);
        commentEl.dataset.target = item.target;

        // Drag the badge to reposition the pin within the element's clickable area.
        let dragging = false;
        openBadge.addEventListener("mousedown", e => {
          e.preventDefault(); e.stopPropagation();
          dragging = true; clearTimeout(hideTimer);
          const onMove = ev => {
            const a = clickAnchor(item.target, ev.clientX, ev.clientY);
            if (a) { item.anchor = a; layoutComment(commentEl); }
          };
          const onUp = () => {
            dragging = false;
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
          };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        });

        commentEl.addEventListener("mouseenter", () => { clearTimeout(hideTimer); openComment(item, false); });
        commentEl.addEventListener("mouseleave", () => {
          if (dragging) return;
          hideTimer = setTimeout(() => { if (openItem === item && document.activeElement !== pinTa && !dragging) closeComment(); }, 200);
        });
        commentEl.addEventListener("click", e => { e.stopPropagation(); openComment(item, true); });

        document.body.append(commentEl);

        if (item.target === prevOpen) {
          openItem = item;
          commentEl.style.zIndex = "1001";
          closedEl.hidden = true;
          openEl.hidden = false;
          const node = document.querySelector(`[data-id="${CSS.escape(item.target)}"]`);
          if (node) node.classList.add("dr-active");
        }
      });

      requestAnimationFrame(layoutComments);
    }

    // ── Preview / copy ──
    function updatePreview() { previewPre.textContent = buildFeedbackMarkdown(meta, overall, items); }

    async function copyFeedback() {
      const text = buildFeedbackMarkdown(meta, overall, items);
      try { await navigator.clipboard.writeText(text); flash("Copied ✓ — paste it to your AI agent"); }
      catch { showFallback(text); }
    }

    function flash(msg) {
      const t = el("div", { class: "dr-toast", text: msg });
      document.body.append(t);
      requestAnimationFrame(() => t.classList.add("dr-show"));
      setTimeout(() => { t.classList.remove("dr-show"); setTimeout(() => t.remove(), 250); }, 2400);
    }

    function showFallback(text) {
      const ta = el("textarea", { rows: "10", readonly: "", "aria-label": "Feedback to copy" });
      ta.value = text;
      ta.style.cssText = "display:block;width:100%;box-sizing:border-box;border:1px solid rgba(9,9,11,.12);border-radius:8px;background:#f9f9f9;font:400 12px/1.5 ui-monospace,monospace;padding:8px;resize:none;margin-top:8px;color:#18181b";
      const close = el("button", { class: "dr-btn", type: "button", text: "Close" });
      const box = el("div", {}); box.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,92vw);background:#fff;border:1px solid rgba(9,9,11,.12);border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,.15);padding:16px;z-index:9999";
      box.append(el("div", { class: "dr-preview-label", text: "Copy manually (Ctrl/⌘ + C)" }), ta, el("div", { style: "margin-top:10px" }, close));
      const modal = el("div", {}); modal.style.cssText = "position:fixed;inset:0;background:rgba(9,9,11,.45);z-index:9998";
      box.addEventListener("click", e => e.stopPropagation());
      close.addEventListener("click", () => modal.remove());
      modal.addEventListener("click", () => modal.remove());
      modal.append(box); document.body.append(modal); ta.focus(); ta.select();
    }

    // ── Wire up ──
    overallInput.addEventListener("input", () => { overall = overallInput.value; autoGrow(overallInput); updatePreview(); updateCounts(); });

    // Copy → copies + toast. Caret → toggles raw-text preview (click, not hover).
    copyBtn.addEventListener("click", () => {
      previewPop.hidden = true; caretBtn.classList.remove("dr-open");
      copyFeedback();
    });
    caretBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (caretBtn.disabled) return;
      const show = previewPop.hidden;
      if (show) updatePreview();
      previewPop.hidden = !show;
      caretBtn.classList.toggle("dr-open", show);
    });

    document.addEventListener("click", () => {
      closeComment(); panel.hidden = true;
      previewPop.hidden = true; caretBtn.classList.remove("dr-open");
    });
    panel.addEventListener("click", e => e.stopPropagation());
    window.addEventListener("resize", () => { positionsDirty = true; layoutComments(); });

    for (const node of document.querySelectorAll("[data-id]")) {
      node.classList.add("dr-target");
      node.addEventListener("click", e => { e.stopPropagation(); addOrEditElement(node.getAttribute("data-id"), e.clientX, e.clientY); });
    }

    document.body.append(panel, trigger);
    renderList();
    renderComments();
    updatePreview();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
