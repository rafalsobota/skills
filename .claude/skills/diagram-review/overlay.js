// Shared diagram-review overlay.
// CLASSIC script (not a module) so it loads from file:// without CORS issues.
// Copied once into the output folder, referenced by every diagram-vN.html.
// All UI + CSS live here, so the HTML files stay tiny.
//
// Model:
//   - ONE whole-diagram comment (commit-message style) at the top of the panel.
//   - Element comments live on the canvas as Figma-style pins: click to add/edit
//     inline, hover to read. The panel lists them for navigation.
//   - "Copy for AI" copies an agent-agnostic Markdown block; hovering it previews
//     the exact text. The panel collapses to a floating launcher pill.
(function () {
  if (typeof document === "undefined") return;

  const ACCENT = "#2563eb";

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

  function plural(n) { return n === 1 ? "comment" : "comments"; }

  function buildFeedbackMarkdown(meta, overall, items) {
    const header = `## Feedback on diagram ${meta.version} (file: ${meta.file})`;
    const o = String(overall || "").trim();
    const live = items.filter((i) => String(i.text).trim());
    const parts = [header];
    if (o) parts.push("> " + o.replace(/\n/g, "\n> "));
    if (live.length) parts.push(live.map((i) => `- **[element: ${i.target}]** ${String(i.text).trim()}`).join("\n"));
    if (parts.length === 1) return `${header}\n\n_(no comments)_\n`;
    return parts.join("\n\n") + "\n";
  }

  function injectStyles() {
    const css = `
    :root {
      --dr-accent: ${ACCENT}; --dr-accent-press: #1d4ed8;
      --dr-bg: #ffffff; --dr-bg-sunken: #fafafa;
      --dr-text: #18181b; --dr-text-soft: #52525b; --dr-text-faint: #a1a1aa;
      --dr-border: rgba(9,9,11,.08); --dr-border-strong: rgba(9,9,11,.14);
      --dr-shadow-pop: 0 12px 32px rgba(9,9,11,.16), 0 2px 8px rgba(9,9,11,.08);
      --dr-w: 340px;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --dr-accent: #3b82f6; --dr-accent-press: #2563eb;
        --dr-bg: #18181b; --dr-bg-sunken: #0f0f11;
        --dr-text: #f4f4f5; --dr-text-soft: #a1a1aa; --dr-text-faint: #71717a;
        --dr-border: rgba(255,255,255,.10); --dr-border-strong: rgba(255,255,255,.16);
        --dr-shadow-pop: 0 12px 32px rgba(0,0,0,.55), 0 2px 8px rgba(0,0,0,.4);
      }
    }
    body { margin: 0 var(--dr-w) 0 0; transition: margin-right .25s ease;
      font-family: system-ui, -apple-system, sans-serif; -webkit-font-smoothing: antialiased; }
    body.dr-collapsed { margin-right: 0; }
    #stage { padding: 32px; box-sizing: border-box; }
    #stage svg { max-width: 100%; height: auto; }

    .dr-target { cursor: pointer; transition: outline-color .12s; outline: 2px solid transparent; outline-offset: 2px; }
    .dr-target:hover { outline-color: color-mix(in srgb, var(--dr-accent) 45%, transparent); }
    .dr-commented { outline-color: color-mix(in srgb, var(--dr-accent) 30%, transparent); }
    .dr-target.dr-active { outline-color: var(--dr-accent); }

    .dr-pin { position: absolute; transform: translate(-50%, -50%); z-index: 2147482000;
      min-width: 22px; height: 22px; padding: 0 6px; box-sizing: border-box; border-radius: 999px 999px 999px 2px;
      background: var(--dr-accent); color: #fff; font: 600 11px/22px system-ui, sans-serif; text-align: center;
      cursor: pointer; border: 0; box-shadow: 0 0 0 2px var(--dr-bg), 0 2px 6px rgba(9,9,11,.3); transition: transform .1s; }
    .dr-pin:hover, .dr-pin.dr-active { transform: translate(-50%, -50%) scale(1.12); background: var(--dr-accent-press); }

    #dr-sidebar { position: fixed; top: 0; right: 0; bottom: 0; width: var(--dr-w);
      background: var(--dr-bg); color: var(--dr-text); border-left: 1px solid var(--dr-border);
      box-shadow: -8px 0 24px rgba(9,9,11,.04); display: flex; flex-direction: column;
      z-index: 2147483000; font-size: 13px; transition: transform .25s ease; }
    #dr-sidebar.dr-collapsed { transform: translateX(100%); pointer-events: none; }

    .dr-head { padding: 16px 16px 12px; border-bottom: 1px solid var(--dr-border); }
    .dr-head-row { display: flex; align-items: center; gap: 8px; }
    .dr-title { font-size: 14px; font-weight: 600; letter-spacing: -.01em; flex: 1; }
    .dr-pill { font: 600 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--dr-text-soft);
      background: var(--dr-bg-sunken); border: 1px solid var(--dr-border); padding: 4px 8px; border-radius: 999px; }
    .dr-icon-btn { width: 28px; height: 28px; display: inline-grid; place-items: center; border-radius: 8px;
      border: 1px solid var(--dr-border); background: var(--dr-bg); color: var(--dr-text-soft); cursor: pointer; font-size: 15px; line-height: 1; }
    .dr-icon-btn:hover { background: var(--dr-bg-sunken); color: var(--dr-text); }

    .dr-overall { padding: 12px 14px; border-bottom: 1px solid var(--dr-border); }
    .dr-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--dr-text-faint); }
    .dr-overall-input { display: block; width: 100%; box-sizing: border-box; margin-top: 6px; padding: 8px 10px;
      border: 1px solid var(--dr-border-strong); border-radius: 8px; background: var(--dr-bg-sunken); color: var(--dr-text);
      font: 400 13px/1.45 system-ui, sans-serif; resize: none; overflow: hidden; min-height: 66px; }
    .dr-overall-input::placeholder { color: var(--dr-text-faint); }
    .dr-overall-input:focus { outline: 2px solid var(--dr-accent); outline-offset: -1px; border-color: transparent; }

    .dr-list-head { display: flex; align-items: center; gap: 8px; padding: 12px 14px 6px; }
    .dr-list { flex: 1; overflow: auto; padding: 0 8px 8px; display: flex; flex-direction: column; gap: 4px; }
    .dr-row { display: flex; align-items: flex-start; gap: 9px; padding: 8px 10px; border-radius: 9px; cursor: pointer; border: 1px solid transparent; }
    .dr-row:hover { background: var(--dr-bg-sunken); border-color: color-mix(in srgb, var(--dr-accent) 25%, var(--dr-border)); }
    .dr-row.dr-row-active { background: color-mix(in srgb, var(--dr-accent) 12%, transparent); border-color: color-mix(in srgb, var(--dr-accent) 45%, var(--dr-border)); }
    .dr-row-text { min-width: 0; flex: 1; }
    .dr-chip { font: 500 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--dr-text-soft);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dr-row-snippet { margin-top: 2px; font-size: 13px; color: var(--dr-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dr-row-snippet.dr-faint { color: var(--dr-text-faint); }
    .dr-badge { flex: 0 0 auto; min-width: 20px; height: 20px; padding: 0 5px; box-sizing: border-box; border-radius: 999px;
      background: var(--dr-accent); color: #fff; font: 600 11px/20px system-ui, sans-serif; text-align: center; }
    .dr-empty { margin: 4px; padding: 18px 16px; text-align: center; color: var(--dr-text-faint);
      border: 1px dashed var(--dr-border-strong); border-radius: 10px; }
    .dr-empty-title { font-size: 13px; font-weight: 600; color: var(--dr-text-soft); }
    .dr-empty-body { margin-top: 6px; font-size: 12px; line-height: 1.5; }

    .dr-foot { position: relative; padding: 12px; border-top: 1px solid var(--dr-border); }
    .dr-btn { width: 100%; height: 36px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--dr-accent);
      background: var(--dr-accent); color: #fff; font: 600 13px/1 system-ui, sans-serif; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
    .dr-btn:hover { background: var(--dr-accent-press); }
    .dr-btn:focus-visible { outline: 2px solid var(--dr-accent); outline-offset: 2px; }
    .dr-btn:disabled { opacity: .5; cursor: default; }

    .dr-preview { position: absolute; left: 12px; right: 12px; bottom: calc(100% + 8px); max-height: 52vh; overflow: auto;
      background: var(--dr-bg); color: var(--dr-text); border: 1px solid var(--dr-border-strong); border-radius: 10px;
      box-shadow: var(--dr-shadow-pop); padding: 10px 12px; }
    .dr-preview[hidden] { display: none; }
    .dr-preview-label { font-size: 11px; font-weight: 600; color: var(--dr-text-faint); margin-bottom: 6px; }
    .dr-preview-pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere;
      font: 400 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--dr-text); }

    #dr-pop { position: fixed; width: 280px; background: var(--dr-bg); color: var(--dr-text);
      border: 1px solid var(--dr-border-strong); border-radius: 12px; box-shadow: var(--dr-shadow-pop);
      padding: 12px; z-index: 2147483500; }
    #dr-pop[hidden] { display: none; }
    .dr-pop-top { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .dr-pop-chip { flex: 1; font: 500 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--dr-text-soft);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dr-pop-del { border: 0; background: transparent; color: var(--dr-text-faint); cursor: pointer; font-size: 12px; padding: 2px 4px; border-radius: 6px; }
    .dr-pop-del:hover { background: color-mix(in srgb, var(--dr-text-soft) 14%, transparent); color: var(--dr-text); }
    .dr-pop-input { display: block; width: 100%; box-sizing: border-box; border: 1px solid var(--dr-border-strong); border-radius: 8px;
      background: var(--dr-bg-sunken); color: var(--dr-text); font: 400 13px/1.45 system-ui, sans-serif; padding: 8px 10px;
      resize: none; overflow: hidden; min-height: 56px; }
    .dr-pop-input:focus { outline: 2px solid var(--dr-accent); outline-offset: -1px; border-color: transparent; }
    .dr-pop-read { font-size: 13px; line-height: 1.5; color: var(--dr-text); overflow-wrap: anywhere; white-space: pre-wrap; }
    .dr-pop-read.dr-faint { color: var(--dr-text-faint); }

    .dr-launcher { position: fixed; top: 16px; right: 16px; z-index: 2147483001; display: inline-flex; align-items: center;
      gap: 8px; height: 36px; padding: 0 14px; border-radius: 999px; background: var(--dr-accent); color: #fff; border: 0;
      font: 600 13px/1 system-ui, sans-serif; box-shadow: var(--dr-shadow-pop); cursor: pointer; }
    .dr-launcher[hidden] { display: none; }
    .dr-launcher-count { font-variant-numeric: tabular-nums; opacity: .85; }

    .dr-toast { position: fixed; bottom: 20px; right: 20px; background: #18181b; color: #fafafa; padding: 10px 14px;
      border-radius: 8px; font-size: 13px; box-shadow: var(--dr-shadow-pop); opacity: 0; transform: translateY(8px);
      transition: opacity .2s, transform .2s; z-index: 2147483600; }
    .dr-toast.dr-show { opacity: 1; transform: translateY(0); }`;
    document.head.append(el("style", { text: css }));
  }

  function autoGrow(ta) { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; }

  function init() {
    const meta = window.diagramMeta || { version: "v?", file: "" };
    let seq = 0;
    let collapsed = false;
    let overall = "";
    const items = []; // { id, target, text } — one per element

    // popover state
    let popMode = null, popItem = null, popPin = null, hideTimer = null;

    injectStyles();

    const numberOf = (target) => items.findIndex((i) => i.target === target) + 1;
    const liveCount = () => (overall.trim() ? 1 : 0) + items.filter((i) => String(i.text).trim()).length;

    // --- sidebar ---
    const pill = el("span", { class: "dr-pill", text: meta.version });
    const collapseBtn = el("button", { class: "dr-icon-btn", type: "button", title: "Collapse panel", "aria-label": "Collapse panel", text: "»" });
    const overallInput = el("textarea", { class: "dr-overall-input", rows: "1",
      placeholder: "Summarize feedback for the whole diagram… (like a commit message)", "aria-label": "Whole-diagram comment" });
    const listCount = el("span", { class: "dr-chip", text: "" });
    const listEl = el("div", { class: "dr-list", role: "list" });
    const copyBtn = el("button", { class: "dr-btn", type: "button", disabled: "", text: "Copy for AI" });
    const previewPre = el("pre", { class: "dr-preview-pre" });
    const previewPop = el("div", { class: "dr-preview", hidden: "" },
      el("div", { class: "dr-preview-label", text: "Will be copied — paste into any AI agent" }), previewPre);
    const sidebar = el("aside", { id: "dr-sidebar", onClick: (e) => e.stopPropagation() },
      el("div", { class: "dr-head" },
        el("div", { class: "dr-head-row" }, el("div", { class: "dr-title", text: "Review" }), pill, collapseBtn)),
      el("div", { class: "dr-overall" }, el("div", { class: "dr-label", text: "Whole diagram" }), overallInput),
      el("div", { class: "dr-list-head" }, el("span", { class: "dr-label", text: "Element comments" }), listCount),
      listEl,
      el("div", { class: "dr-foot" }, previewPop, copyBtn),
    );
    const launcherCount = el("span", { class: "dr-launcher-count" });
    const launcher = el("button", { class: "dr-launcher", type: "button", hidden: "", "aria-label": "Open review panel" },
      el("span", { text: "Review" }), launcherCount);

    // --- canvas popover (read + edit) ---
    const popBody = el("div", {});
    const pop = el("div", { id: "dr-pop", hidden: "",
      onMouseenter: () => clearTimeout(hideTimer),
      onMouseleave: () => { if (popMode === "read") scheduleHide(); },
      onClick: (e) => e.stopPropagation() }, popBody);

    function scheduleHide() { clearTimeout(hideTimer); hideTimer = setTimeout(hidePop, 180); }
    function hidePop() { pop.hidden = true; popMode = null; popItem = null; popPin = null; clearRows(); }
    function placePop(pinEl) {
      const w = 280, gap = 12, h = pop.offsetHeight || 140;
      const node = document.querySelector(`[data-id="${CSS.escape(pinEl.dataset.target)}"]`);
      const rect = node ? node.getBoundingClientRect() : pinEl.getBoundingClientRect();
      const sidebarLeft = collapsed ? window.innerWidth : window.innerWidth - 340;
      let left, top;
      if (rect.left - gap - w >= 10) { left = rect.left - gap - w; top = rect.top; }            // left of node
      else if (rect.right + gap + w <= sidebarLeft - 10) { left = rect.right + gap; top = rect.top; } // right of node
      else { // tight: place below (or above) the node so it never covers it
        left = Math.max(10, Math.min(rect.left, sidebarLeft - w - 10));
        top = (rect.bottom + gap + h <= window.innerHeight - 10) ? rect.bottom + gap : rect.top - gap - h;
      }
      pop.style.left = left + "px";
      pop.style.top = Math.min(Math.max(10, top), window.innerHeight - h - 10) + "px";
    }

    function showRead(item, pinEl) {
      if (popMode === "edit") return;
      popMode = "read"; popItem = item; popPin = pinEl;
      const txt = String(item.text).trim();
      popBody.replaceChildren(
        el("div", { class: "dr-pop-top" }, el("span", { class: "dr-badge", text: String(numberOf(item.target)) }), el("span", { class: "dr-pop-chip", text: item.target })),
        el("div", { class: "dr-pop-read" + (txt ? "" : " dr-faint"), text: txt || "Empty — click to add a comment" }),
      );
      pop.hidden = false; placePop(pinEl);
      activateRow(item.target, false);
    }

    function showEdit(item, pinEl) {
      popMode = "edit"; popItem = item; popPin = pinEl;
      const ta = el("textarea", { class: "dr-pop-input", rows: "1", placeholder: "Add a comment…", "aria-label": "Element comment" });
      ta.value = item.text;
      ta.addEventListener("input", () => { item.text = ta.value; autoGrow(ta); renderList(); updatePreview(); });
      ta.addEventListener("blur", () => { if (!String(item.text).trim()) deleteItem(item); });
      ta.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); ta.blur(); hidePop(); } });
      const del = el("button", { class: "dr-pop-del", type: "button", text: "Delete",
        onClick: (e) => { e.stopPropagation(); deleteItem(item); } });
      popBody.replaceChildren(
        el("div", { class: "dr-pop-top" }, el("span", { class: "dr-badge", text: String(numberOf(item.target)) }), el("span", { class: "dr-pop-chip", text: item.target }), del),
        ta,
      );
      pop.hidden = false; placePop(pinEl);
      ta.focus(); const len = ta.value.length; ta.setSelectionRange(len, len); autoGrow(ta);
      activateRow(item.target, true);
    }

    function addOrEditElement(target) {
      let item = items.find((i) => i.target === target);
      if (!item) { item = { id: ++seq, target, text: "" }; items.push(item); renderList(); renderPins(); }
      const pin = document.querySelector(`.dr-pin[data-target="${CSS.escape(target)}"]`);
      if (pin) showEdit(item, pin);
    }
    function deleteItem(item) {
      const i = items.indexOf(item);
      if (i >= 0) items.splice(i, 1);
      hidePop(); renderList(); renderPins(); updatePreview();
    }

    function setActive(target, on) {
      const node = document.querySelector(`[data-id="${CSS.escape(target)}"]`);
      if (node) node.classList.toggle("dr-active", on);
      const pin = document.querySelector(`.dr-pin[data-target="${CSS.escape(target)}"]`);
      if (pin) pin.classList.toggle("dr-active", on);
    }
    function activateRow(target, scroll) {
      for (const row of listEl.querySelectorAll(".dr-row")) {
        const on = row.dataset.target === target;
        row.classList.toggle("dr-row-active", on);
        if (on && scroll) row.scrollIntoView({ block: "nearest" });
      }
    }
    function clearRows() { for (const row of listEl.querySelectorAll(".dr-row-active")) row.classList.remove("dr-row-active"); }

    function renderList() {
      listEl.replaceChildren();
      if (!items.length) {
        listEl.append(el("div", { class: "dr-empty" },
          el("div", { class: "dr-empty-title", text: "No element comments" }),
          el("div", { class: "dr-empty-body", text: "Click any element in the diagram to drop a pin and comment on it." })));
      } else {
        items.forEach((item, i) => {
          const txt = String(item.text).trim();
          const row = el("div", { class: "dr-row", role: "listitem",
            onMouseenter: () => setActive(item.target, true), onMouseleave: () => setActive(item.target, false),
            onClick: () => {
              if (collapsed) setCollapsed(false);
              const node = document.querySelector(`[data-id="${CSS.escape(item.target)}"]`);
              if (node) node.scrollIntoView({ block: "center", behavior: "smooth" });
              setTimeout(() => { const pin = document.querySelector(`.dr-pin[data-target="${CSS.escape(item.target)}"]`); if (pin) showEdit(item, pin); }, 280);
            } },
            el("span", { class: "dr-badge", text: String(i + 1) }),
            el("div", { class: "dr-row-text" },
              el("div", { class: "dr-chip", text: item.target }),
              el("div", { class: "dr-row-snippet" + (txt ? "" : " dr-faint"), text: txt || "No comment yet" })),
          );
          row.dataset.target = item.target;
          listEl.append(row);
        });
      }
      listCount.textContent = items.length ? String(items.length) : "";
      const n = liveCount();
      copyBtn.disabled = n === 0;
      launcherCount.textContent = n ? String(n) : "";
      if (popItem) activateRow(popItem.target, false); // keep highlight across re-renders
    }

    function renderPins() {
      for (const p of document.querySelectorAll(".dr-pin")) p.remove();
      items.forEach((item, i) => {
        const pin = el("button", { class: "dr-pin", type: "button", text: String(i + 1),
          onMouseenter: () => { clearTimeout(hideTimer); setActive(item.target, true); showRead(item, pin); },
          onMouseleave: () => { setActive(item.target, false); if (popMode === "read") scheduleHide(); },
          onClick: (e) => { e.stopPropagation(); showEdit(item, pin); } });
        pin.dataset.target = item.target;
        document.body.append(pin);
      });
      // persistent markers on commented elements
      const commented = new Set(items.map((i) => i.target));
      for (const node of document.querySelectorAll("[data-id]"))
        node.classList.toggle("dr-commented", commented.has(node.getAttribute("data-id")));
      layoutPins();
    }

    function layoutPins() {
      const sx = window.scrollX, sy = window.scrollY;
      for (const pin of document.querySelectorAll(".dr-pin")) {
        const node = document.querySelector(`[data-id="${CSS.escape(pin.dataset.target)}"]`);
        if (!node) { pin.style.display = "none"; continue; }
        pin.style.display = "";
        const r = node.getBoundingClientRect();
        pin.style.left = (r.right + sx) + "px";
        pin.style.top = (r.top + sy) + "px";
      }
      if (!pop.hidden && popPin) placePop(popPin);
    }
    function animatePins() {
      let start = null;
      const step = (ts) => { if (start == null) start = ts; layoutPins(); if (ts - start < 340) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }

    function setCollapsed(v) {
      collapsed = v;
      sidebar.classList.toggle("dr-collapsed", v);
      document.body.classList.toggle("dr-collapsed", v);
      launcher.hidden = !v;
      if (v) hidePop();
      animatePins();
    }

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
      const ta = el("textarea", { class: "dr-pop-input", rows: "10", readonly: "", "aria-label": "Feedback to copy" });
      ta.value = text;
      const close = el("button", { class: "dr-btn", type: "button", text: "Close" });
      const box = el("div", {});
      box.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,92vw);" +
        "background:var(--dr-bg);color:var(--dr-text);border:1px solid var(--dr-border-strong);border-radius:14px;" +
        "box-shadow:var(--dr-shadow-pop);padding:16px";
      box.append(el("div", { class: "dr-label", text: "Copy manually (Ctrl/⌘ + C)" }), ta, el("div", { style: "margin-top:10px" }, close));
      const modal = el("div", {}, box);
      modal.style.cssText = "position:fixed;inset:0;background:rgba(9,9,11,.45);z-index:2147483647";
      box.addEventListener("click", (e) => e.stopPropagation());
      close.addEventListener("click", () => modal.remove());
      modal.addEventListener("click", () => modal.remove());
      document.body.append(modal);
      ta.focus(); ta.select();
    }

    // --- wire up ---
    overallInput.addEventListener("input", () => { overall = overallInput.value; autoGrow(overallInput); renderList(); updatePreview(); });
    overallInput.addEventListener("focus", hidePop);
    collapseBtn.addEventListener("click", (e) => { e.stopPropagation(); setCollapsed(true); });
    launcher.addEventListener("click", (e) => { e.stopPropagation(); setCollapsed(false); });
    copyBtn.addEventListener("click", copyFeedback);

    let previewTimer = null;
    const showPreview = () => { if (copyBtn.disabled) return; updatePreview(); previewPop.hidden = false; };
    const hidePreviewSoon = () => { clearTimeout(previewTimer); previewTimer = setTimeout(() => { previewPop.hidden = true; }, 160); };
    copyBtn.addEventListener("mouseenter", showPreview);
    copyBtn.addEventListener("mouseleave", hidePreviewSoon);
    copyBtn.addEventListener("focus", showPreview);
    copyBtn.addEventListener("blur", hidePreviewSoon);
    previewPop.addEventListener("mouseenter", () => clearTimeout(previewTimer));
    previewPop.addEventListener("mouseleave", hidePreviewSoon);

    document.addEventListener("click", () => { if (popMode) hidePop(); });
    window.addEventListener("resize", layoutPins);
    window.addEventListener("scroll", layoutPins, { passive: true });

    for (const node of document.querySelectorAll("[data-id]")) {
      node.classList.add("dr-target");
      node.addEventListener("click", (e) => { e.stopPropagation(); if (collapsed) setCollapsed(false); addOrEditElement(node.getAttribute("data-id")); });
    }

    document.body.append(sidebar, launcher, pop);
    renderList();
    renderPins();
    updatePreview();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
