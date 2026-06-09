// Shared diagram-review overlay.
// CLASSIC script (not a module) so it loads from file:// without CORS issues.
// Copied once into the output folder, referenced by every diagram-vN.html.
// All UI + CSS live here, so the HTML files stay tiny.
//
// Model: the sidebar is a live workspace. Every comment is an always-editable
// textarea (autosave on input, empty ones drop on blur). Clicking a diagram
// element creates a focused card + pin. A persistent draft row at the bottom adds
// whole-diagram comments. The panel collapses to a floating launcher pill.
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

  function buildFeedbackMarkdown(meta, comments) {
    const live = comments.filter((c) => String(c.text).trim());
    const header = `## Feedback on diagram ${meta.version} (file: ${meta.file})`;
    if (!live.length) return `${header}\n\n_(no comments)_\n`;
    const lines = live.map((c) => {
      const tag = c.target == null ? "[whole diagram]" : `[element: ${c.target}]`;
      return `- **${tag}** ${String(c.text).trim()}`;
    });
    return `${header}\n\n${lines.join("\n")}\n`;
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
      min-width: 22px; height: 22px; padding: 0 6px; box-sizing: border-box; border-radius: 999px;
      background: var(--dr-accent); color: #fff; font: 600 11px/22px system-ui, sans-serif;
      text-align: center; cursor: pointer; border: 0; box-shadow: 0 0 0 2px var(--dr-bg), 0 2px 6px rgba(9,9,11,.3);
      transition: transform .1s; }
    .dr-pin:hover, .dr-pin.dr-active { transform: translate(-50%, -50%) scale(1.12); background: var(--dr-accent-press); }

    #dr-sidebar { position: fixed; top: 0; right: 0; bottom: 0; width: var(--dr-w);
      background: var(--dr-bg); color: var(--dr-text); border-left: 1px solid var(--dr-border);
      box-shadow: -8px 0 24px rgba(9,9,11,.04); display: flex; flex-direction: column;
      z-index: 2147483000; font-size: 13px; transition: transform .25s ease; }
    #dr-sidebar.dr-collapsed { transform: translateX(100%); pointer-events: none; }

    .dr-head { padding: 16px 16px 12px; border-bottom: 1px solid var(--dr-border); }
    .dr-head-row { display: flex; align-items: center; gap: 8px; }
    .dr-title { font-size: 14px; font-weight: 600; letter-spacing: -.01em; }
    .dr-pill { font: 600 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--dr-text-soft);
      background: var(--dr-bg-sunken); border: 1px solid var(--dr-border); padding: 4px 8px; border-radius: 999px; }
    .dr-icon-btn { width: 28px; height: 28px; display: inline-grid; place-items: center; border-radius: 8px;
      border: 1px solid var(--dr-border); background: var(--dr-bg); color: var(--dr-text-soft); cursor: pointer; font-size: 15px; line-height: 1; }
    .dr-icon-btn:hover { background: var(--dr-bg-sunken); color: var(--dr-text); }
    .dr-sub { margin-top: 6px; color: var(--dr-text-faint); font-size: 12px; font-variant-numeric: tabular-nums; }

    .dr-list { flex: 1; overflow: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
    .dr-card { position: relative; padding: 9px 11px; border: 1px solid var(--dr-border); border-radius: 10px;
      background: var(--dr-bg); cursor: text; }
    .dr-card:hover { border-color: color-mix(in srgb, var(--dr-accent) 30%, var(--dr-border)); }
    .dr-card:focus-within { border-color: var(--dr-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dr-accent) 14%, transparent); }
    .dr-draft { border-style: dashed; }
    .dr-card-top { display: flex; align-items: center; gap: 8px; }
    .dr-badge { flex: 0 0 auto; min-width: 20px; height: 20px; padding: 0 5px; box-sizing: border-box; border-radius: 999px;
      background: var(--dr-accent); color: #fff; font: 600 11px/20px system-ui, sans-serif; text-align: center; }
    .dr-badge.dr-global { background: color-mix(in srgb, var(--dr-text-soft) 22%, transparent); color: var(--dr-text-soft); }
    .dr-chip { flex: 1; font: 500 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--dr-text-soft);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dr-card-input { display: block; width: 100%; box-sizing: border-box; border: 0; background: transparent; resize: none;
      overflow: hidden; margin-top: 6px; padding: 0; outline: none; min-height: 18px;
      font: 400 13px/1.45 system-ui, sans-serif; color: var(--dr-text); }
    .dr-card-input::placeholder { color: var(--dr-text-faint); }
    .dr-del { position: absolute; top: 5px; right: 5px; width: 22px; height: 22px; border: 0; border-radius: 6px;
      background: transparent; color: var(--dr-text-faint); font-size: 16px; line-height: 1; cursor: pointer; opacity: 0; }
    .dr-card:hover .dr-del { opacity: 1; }
    .dr-del:hover { background: color-mix(in srgb, var(--dr-text-soft) 14%, transparent); color: var(--dr-text); }

    .dr-empty { margin: 8px 4px 2px; padding: 18px 16px; text-align: center; color: var(--dr-text-faint);
      border: 1px dashed var(--dr-border-strong); border-radius: 10px; }
    .dr-empty-title { font-size: 13px; font-weight: 600; color: var(--dr-text-soft); }
    .dr-empty-body { margin-top: 6px; font-size: 12px; line-height: 1.5; }

    .dr-foot { padding: 12px; border-top: 1px solid var(--dr-border); }
    .dr-btn { width: 100%; height: 36px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--dr-border-strong);
      background: var(--dr-accent); color: #fff; font: 600 13px/1 system-ui, sans-serif; cursor: pointer;
      border-color: var(--dr-accent); display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
    .dr-btn:hover { background: var(--dr-accent-press); }
    .dr-btn:focus-visible { outline: 2px solid var(--dr-accent); outline-offset: 2px; }
    .dr-btn:disabled { opacity: .5; cursor: default; background: var(--dr-accent); }

    .dr-launcher { position: fixed; top: 16px; right: 16px; z-index: 2147483001; display: inline-flex; align-items: center;
      gap: 8px; height: 36px; padding: 0 14px; border-radius: 999px; background: var(--dr-accent); color: #fff; border: 0;
      font: 600 13px/1 system-ui, sans-serif; box-shadow: var(--dr-shadow-pop); cursor: pointer; }
    .dr-launcher[hidden] { display: none; }
    .dr-launcher-count { font-variant-numeric: tabular-nums; opacity: .85; }

    .dr-toast { position: fixed; bottom: 20px; right: 20px; background: #18181b; color: #fafafa; padding: 10px 14px;
      border-radius: 8px; font-size: 13px; box-shadow: var(--dr-shadow-pop); opacity: 0; transform: translateY(8px);
      transition: opacity .2s, transform .2s; z-index: 2147483600; }
    .dr-toast.dr-show { opacity: 1; transform: translateY(0); }

    .dr-modal { position: fixed; inset: 0; background: rgba(9,9,11,.45); display: grid; place-items: center; z-index: 2147483647; }
    .dr-modal-box { background: var(--dr-bg); color: var(--dr-text); padding: 18px; border-radius: 14px;
      width: min(560px, 92vw); box-shadow: var(--dr-shadow-pop); }
    .dr-modal-box p { margin: 0 0 10px; font-size: 13px; color: var(--dr-text-soft); }
    .dr-modal-text { width: 100%; box-sizing: border-box; font: 400 13px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
      padding: 10px; border-radius: 8px; border: 1px solid var(--dr-border-strong); background: var(--dr-bg-sunken); color: var(--dr-text); resize: vertical; }
    .dr-modal-actions { display: flex; justify-content: flex-end; margin-top: 12px; }
    .dr-modal-actions .dr-btn { width: auto; padding: 0 16px; }`;
    document.head.append(el("style", { text: css }));
  }

  function autoGrow(ta) { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; }

  function init() {
    const meta = window.diagramMeta || { version: "v?", file: "" };
    let seq = 0;
    let collapsed = false;
    let pendingFocus = null; // {id} | {draft:true}
    const comments = []; // { id, target: string|null, text }

    injectStyles();

    // --- sidebar skeleton ---
    const pill = el("span", { class: "dr-pill", text: meta.version });
    const collapseBtn = el("button", { class: "dr-icon-btn", type: "button", title: "Collapse panel", "aria-label": "Collapse panel", text: "»" });
    const sub = el("div", { class: "dr-sub" });
    const listEl = el("div", { class: "dr-list", role: "list" });
    const copyBtn = el("button", { class: "dr-btn", type: "button", disabled: "", text: "Copy for Claude" });
    const sidebar = el("aside", { id: "dr-sidebar", onClick: (e) => e.stopPropagation() },
      el("div", { class: "dr-head" },
        el("div", { class: "dr-head-row" },
          el("div", { class: "dr-title", text: "Review" }),
          el("span", { class: "dr-chip" }), // spacer
          pill, collapseBtn,
        ),
        sub,
      ),
      listEl,
      el("div", { class: "dr-foot" }, copyBtn),
    );
    const launcherCount = el("span", { class: "dr-launcher-count" });
    const launcher = el("button", { class: "dr-launcher", type: "button", hidden: "", "aria-label": "Open review panel" },
      el("span", { text: "Review" }), launcherCount);

    // --- comment ops ---
    function addElementComment(target) {
      const c = { id: ++seq, target, text: "" };
      comments.push(c);
      pendingFocus = { id: c.id };
      render();
    }
    function commitDraft(text) {
      if (!text.trim()) return;
      comments.push({ id: ++seq, target: null, text: text.trim() });
      pendingFocus = { draft: true };
      render();
    }
    function removeComment(c) {
      const i = comments.indexOf(c);
      if (i >= 0) { comments.splice(i, 1); render(); }
    }

    function pinOrder() {
      const order = [];
      for (const c of comments) if (c.target != null && !order.includes(c.target)) order.push(c.target);
      return order;
    }
    function setActive(target, on) {
      if (target == null) return;
      const node = document.querySelector(`[data-id="${CSS.escape(target)}"]`);
      if (node) node.classList.toggle("dr-active", on);
      for (const p of document.querySelectorAll(".dr-pin"))
        if (p.dataset.target === target) p.classList.toggle("dr-active", on);
    }

    function commentCard(c, numberOf) {
      const isGlobal = c.target == null;
      const badge = el("span", { class: "dr-badge" + (isGlobal ? " dr-global" : ""), text: isGlobal ? "◇" : String(numberOf(c.target)) });
      const chip = el("span", { class: "dr-chip", text: isGlobal ? "Whole diagram" : c.target });
      const del = el("button", { class: "dr-del", type: "button", title: "Delete", "aria-label": "Delete comment", text: "×",
        onClick: (e) => { e.stopPropagation(); removeComment(c); } });
      const ta = el("textarea", { class: "dr-card-input", rows: "1", "aria-label": "Comment text" });
      ta.value = c.text;
      ta.addEventListener("input", () => { c.text = ta.value; autoGrow(ta); });
      ta.addEventListener("blur", () => { if (!ta.value.trim()) removeComment(c); });
      const card = el("div", { class: "dr-card", role: "listitem",
        onMouseenter: () => setActive(c.target, true), onMouseleave: () => setActive(c.target, false) },
        el("div", { class: "dr-card-top" }, badge, chip, del),
        ta,
      );
      card.dataset.cid = String(c.id);
      card.dataset.target = isGlobal ? "" : c.target;
      return card;
    }

    function draftCard(prevValue) {
      const badge = el("span", { class: "dr-badge dr-global", text: "+" });
      const chip = el("span", { class: "dr-chip", text: "Whole diagram" });
      const ta = el("textarea", { class: "dr-card-input", rows: "1", placeholder: "Comment on the whole diagram…", "aria-label": "New whole-diagram comment" });
      if (prevValue) ta.value = prevValue;
      ta.addEventListener("input", () => autoGrow(ta));
      ta.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitDraft(ta.value); }
        else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); commitDraft(ta.value); }
      });
      ta.addEventListener("blur", () => { if (ta.value.trim()) commitDraft(ta.value); });
      const card = el("div", { class: "dr-card dr-draft" }, el("div", { class: "dr-card-top" }, badge, chip), ta);
      card.dataset.draft = "1";
      return card;
    }

    function render() {
      // preserve in-progress draft text + focus across re-render
      const prevDraftEl = listEl.querySelector('[data-draft="1"] .dr-card-input');
      const prevDraftVal = prevDraftEl ? prevDraftEl.value : "";
      const draftWasFocused = prevDraftEl && document.activeElement === prevDraftEl;

      const order = pinOrder();
      const numberOf = (t) => order.indexOf(t) + 1;

      listEl.replaceChildren();
      if (!comments.length) {
        listEl.append(el("div", { class: "dr-empty" },
          el("div", { class: "dr-empty-title", text: "No comments yet" }),
          el("div", { class: "dr-empty-body", text: "Click any element to comment on it, or type below to comment on the whole diagram." }),
        ));
      } else {
        for (const c of comments) listEl.append(commentCard(c, numberOf));
      }
      const draft = draftCard(draftWasFocused ? prevDraftVal : "");
      listEl.append(draft);

      // counter + copy state
      const n = comments.filter((c) => String(c.text).trim()).length;
      sub.textContent = n ? `${n} ${plural(n)}` : "Click an element, or type below";
      copyBtn.disabled = n === 0;
      launcherCount.textContent = n ? String(n) : "";

      // element markers
      const commented = new Set(order);
      for (const node of document.querySelectorAll("[data-id]"))
        node.classList.toggle("dr-commented", commented.has(node.getAttribute("data-id")));

      // pins
      for (const p of document.querySelectorAll(".dr-pin")) p.remove();
      order.forEach((target, i) => {
        const pin = el("button", { class: "dr-pin", type: "button", text: String(i + 1),
          onMouseenter: () => setActive(target, true), onMouseleave: () => setActive(target, false),
          onClick: (e) => { e.stopPropagation(); if (collapsed) setCollapsed(false); focusCard(target); } });
        pin.dataset.target = target;
        document.body.append(pin);
      });
      layoutPins();

      // restore focus
      if (pendingFocus && pendingFocus.id != null) {
        const ta = listEl.querySelector(`[data-cid="${pendingFocus.id}"] .dr-card-input`);
        if (ta) { ta.focus(); }
      } else if ((pendingFocus && pendingFocus.draft) || draftWasFocused) {
        const ta = draft.querySelector(".dr-card-input");
        if (ta) { ta.focus(); const len = ta.value.length; ta.setSelectionRange(len, len); }
      }
      pendingFocus = null;
      for (const ta of listEl.querySelectorAll(".dr-card-input")) autoGrow(ta);
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
    }
    function animatePins() {
      let start = null;
      const step = (ts) => { if (start == null) start = ts; layoutPins(); if (ts - start < 340) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }

    function focusCard(target) {
      for (const card of listEl.querySelectorAll(".dr-card")) {
        if (card.dataset.target === target) {
          card.scrollIntoView({ block: "nearest", behavior: "smooth" });
          card.animate([{ background: "color-mix(in srgb, var(--dr-accent) 16%, transparent)" }, { background: "transparent" }],
            { duration: 900, easing: "ease-out" });
          break;
        }
      }
    }

    function setCollapsed(v) {
      collapsed = v;
      sidebar.classList.toggle("dr-collapsed", v);
      document.body.classList.toggle("dr-collapsed", v);
      launcher.hidden = !v;
      animatePins();
    }

    async function copyForClaude() {
      const text = buildFeedbackMarkdown(meta, comments);
      try { await navigator.clipboard.writeText(text); flash("Copied ✓ — paste into your Claude chat"); }
      catch { showFallback(text); }
    }
    function flash(msg) {
      const t = el("div", { class: "dr-toast", text: msg });
      document.body.append(t);
      requestAnimationFrame(() => t.classList.add("dr-show"));
      setTimeout(() => { t.classList.remove("dr-show"); setTimeout(() => t.remove(), 250); }, 2400);
    }
    function showFallback(text) {
      const ta = el("textarea", { class: "dr-modal-text", rows: "10", readonly: "", "aria-label": "Feedback to copy" });
      ta.value = text;
      const close = el("button", { class: "dr-btn", type: "button", text: "Close" });
      const modal = el("div", { class: "dr-modal" },
        el("div", { class: "dr-modal-box" },
          el("p", { text: "Copy manually (Ctrl/⌘ + C), then paste into your Claude chat:" }),
          ta,
          el("div", { class: "dr-modal-actions" }, close),
        ),
      );
      close.addEventListener("click", () => modal.remove());
      modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
      document.body.append(modal);
      ta.focus(); ta.select();
    }

    // --- wire up ---
    collapseBtn.addEventListener("click", (e) => { e.stopPropagation(); setCollapsed(true); });
    launcher.addEventListener("click", (e) => { e.stopPropagation(); setCollapsed(false); });
    copyBtn.addEventListener("click", copyForClaude);
    window.addEventListener("resize", layoutPins);
    window.addEventListener("scroll", layoutPins, { passive: true });

    for (const node of document.querySelectorAll("[data-id]")) {
      node.classList.add("dr-target");
      node.addEventListener("click", (e) => { e.stopPropagation(); if (collapsed) setCollapsed(false); addElementComment(node.getAttribute("data-id")); });
    }

    document.body.append(sidebar, launcher);
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
