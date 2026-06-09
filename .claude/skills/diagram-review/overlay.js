// Shared diagram-review overlay.
// CLASSIC script (not a module) so it loads from file:// without CORS issues.
// Copied once into the output folder, referenced by every diagram-vN.html.
// All UI + CSS live here, so the HTML files stay tiny.
(function () {
  if (typeof document === "undefined") return;

  const ACCENT = "#2563eb";

  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    if (props) for (const k in props) {
      const v = props[k];
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "html") { /* intentionally unsupported — never innerHTML */ }
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v != null) n.setAttribute(k, v);
    }
    for (const kid of kids) if (kid != null) n.append(kid);
    return n;
  }

  function plural(n) { return n === 1 ? "comment" : "comments"; }

  function buildFeedbackMarkdown(meta, comments) {
    const header = `## Feedback on diagram ${meta.version} (file: ${meta.file})`;
    if (!comments.length) return `${header}\n\n_(no comments)_\n`;
    const lines = comments.map((c) => {
      const tag = c.target == null ? "[whole diagram]" : `[element: ${c.target}]`;
      return `- **${tag}** ${String(c.text).trim()}`;
    });
    return `${header}\n\n${lines.join("\n")}\n`;
  }

  function injectStyles() {
    const css = `
    :root {
      --dr-accent: ${ACCENT};
      --dr-accent-press: #1d4ed8;
      --dr-bg: #ffffff;
      --dr-bg-sunken: #fafafa;
      --dr-text: #18181b;
      --dr-text-soft: #52525b;
      --dr-text-faint: #a1a1aa;
      --dr-border: rgba(9,9,11,.08);
      --dr-border-strong: rgba(9,9,11,.14);
      --dr-shadow: 0 1px 2px rgba(9,9,11,.04), 0 8px 24px rgba(9,9,11,.06);
      --dr-shadow-pop: 0 12px 32px rgba(9,9,11,.16), 0 2px 8px rgba(9,9,11,.08);
      --dr-w: 340px;
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --dr-accent: #3b82f6; --dr-accent-press: #2563eb;
        --dr-bg: #18181b; --dr-bg-sunken: #0f0f11;
        --dr-text: #f4f4f5; --dr-text-soft: #a1a1aa; --dr-text-faint: #71717a;
        --dr-border: rgba(255,255,255,.10); --dr-border-strong: rgba(255,255,255,.16);
        --dr-shadow: 0 1px 2px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.4);
        --dr-shadow-pop: 0 12px 32px rgba(0,0,0,.55), 0 2px 8px rgba(0,0,0,.4);
      }
    }
    body { margin: 0 var(--dr-w) 0 0; font-family: system-ui, -apple-system, sans-serif;
      -webkit-font-smoothing: antialiased; }
    #stage { padding: 32px; box-sizing: border-box; }
    #stage svg { max-width: 100%; height: auto; }

    /* commentable elements */
    .dr-target { cursor: pointer; transition: outline-color .12s; outline: 2px solid transparent; outline-offset: 2px; }
    .dr-target:hover { outline-color: color-mix(in srgb, var(--dr-accent) 45%, transparent); }
    .dr-commented { outline-color: color-mix(in srgb, var(--dr-accent) 30%, transparent); }
    .dr-target.dr-active { outline-color: var(--dr-accent); }

    /* pins */
    .dr-pin { position: absolute; transform: translate(-50%, -50%); z-index: 2147482000;
      min-width: 22px; height: 22px; padding: 0 6px; box-sizing: border-box; border-radius: 999px;
      background: var(--dr-accent); color: #fff; font: 600 11px/22px system-ui, sans-serif;
      text-align: center; cursor: pointer; border: 0; box-shadow: 0 0 0 2px var(--dr-bg), 0 2px 6px rgba(9,9,11,.3);
      transition: transform .1s; }
    .dr-pin:hover, .dr-pin.dr-active { transform: translate(-50%, -50%) scale(1.12); background: var(--dr-accent-press); }

    /* sidebar */
    #dr-sidebar { position: fixed; top: 0; right: 0; bottom: 0; width: var(--dr-w);
      background: var(--dr-bg); color: var(--dr-text); border-left: 1px solid var(--dr-border);
      box-shadow: -8px 0 24px rgba(9,9,11,.04); display: flex; flex-direction: column;
      z-index: 2147483000; font-size: 13px; }
    .dr-head { padding: 16px 18px 14px; border-bottom: 1px solid var(--dr-border); }
    .dr-head-row { display: flex; align-items: center; gap: 8px; }
    .dr-title { font-size: 14px; font-weight: 600; letter-spacing: -.01em; }
    .dr-pill { margin-left: auto; font: 600 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
      color: var(--dr-text-soft); background: var(--dr-bg-sunken); border: 1px solid var(--dr-border);
      padding: 4px 8px; border-radius: 999px; }
    .dr-sub { margin-top: 4px; color: var(--dr-text-faint); font-size: 12px; font-variant-numeric: tabular-nums; }

    .dr-list { flex: 1; overflow: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
    .dr-card { position: relative; padding: 10px 12px; border: 1px solid var(--dr-border);
      border-radius: 10px; background: var(--dr-bg); cursor: default; }
    .dr-card:hover { background: var(--dr-bg-sunken); border-color: color-mix(in srgb, var(--dr-accent) 30%, var(--dr-border)); }
    .dr-card-top { display: flex; align-items: center; gap: 8px; }
    .dr-badge { flex: 0 0 auto; min-width: 20px; height: 20px; padding: 0 5px; box-sizing: border-box;
      border-radius: 999px; background: var(--dr-accent); color: #fff; font: 600 11px/20px system-ui, sans-serif;
      text-align: center; }
    .dr-badge.dr-global { background: color-mix(in srgb, var(--dr-text-soft) 22%, transparent); color: var(--dr-text-soft); }
    .dr-chip { font: 500 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--dr-text-soft);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dr-card-text { margin-top: 6px; color: var(--dr-text); font-size: 13px; line-height: 1.45; overflow-wrap: anywhere; }
    .dr-del { position: absolute; top: 6px; right: 6px; width: 22px; height: 22px; border: 0; border-radius: 6px;
      background: transparent; color: var(--dr-text-faint); font-size: 16px; line-height: 1; cursor: pointer; opacity: 0; }
    .dr-card:hover .dr-del { opacity: 1; }
    .dr-del:hover { background: color-mix(in srgb, var(--dr-text-soft) 14%, transparent); color: var(--dr-text); }

    .dr-empty { margin: auto; padding: 32px 24px; text-align: center; color: var(--dr-text-faint); }
    .dr-empty-title { font-size: 13px; font-weight: 600; color: var(--dr-text-soft); }
    .dr-empty-body { margin-top: 6px; font-size: 12px; line-height: 1.5; }

    .dr-foot { padding: 12px; border-top: 1px solid var(--dr-border); display: flex; flex-direction: column; gap: 8px; }

    .dr-btn { height: 34px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--dr-border-strong);
      background: var(--dr-bg); color: var(--dr-text); font: 500 13px/1 system-ui, sans-serif; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
    .dr-btn:hover { background: var(--dr-bg-sunken); }
    .dr-btn:focus-visible { outline: 2px solid var(--dr-accent); outline-offset: 2px; }
    .dr-btn-primary { background: var(--dr-accent); border-color: var(--dr-accent); color: #fff; font-weight: 600; }
    .dr-btn-primary:hover { background: var(--dr-accent-press); }
    .dr-btn-primary:disabled { opacity: .5; cursor: default; background: var(--dr-accent); }
    .dr-btn-block { width: 100%; }

    /* composer */
    #dr-composer { position: fixed; width: 300px; background: var(--dr-bg); color: var(--dr-text);
      border: 1px solid var(--dr-border-strong); border-radius: 12px; box-shadow: var(--dr-shadow-pop);
      padding: 12px; z-index: 2147483600; }
    #dr-composer[hidden] { display: none; }
    .dr-comp-target { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; margin-bottom: 8px;
      font: 600 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--dr-accent);
      background: color-mix(in srgb, var(--dr-accent) 10%, transparent); padding: 5px 8px; border-radius: 6px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dr-comp-target.dr-global { color: var(--dr-text-soft); background: var(--dr-bg-sunken); }
    .dr-input { width: 100%; box-sizing: border-box; font: 400 13px/1.45 system-ui, sans-serif; padding: 8px 10px;
      border-radius: 8px; border: 1px solid var(--dr-border-strong); background: var(--dr-bg); color: var(--dr-text);
      resize: vertical; min-height: 64px; }
    .dr-input:focus { outline: 2px solid var(--dr-accent); outline-offset: -1px; border-color: transparent; }
    .dr-comp-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
    .dr-comp-actions .dr-btn { height: 30px; }

    /* toast */
    .dr-toast { position: fixed; bottom: 20px; right: calc(var(--dr-w) + 20px); background: #18181b; color: #fafafa;
      padding: 10px 14px; border-radius: 8px; font-size: 13px; box-shadow: var(--dr-shadow-pop);
      opacity: 0; transform: translateY(8px); transition: opacity .2s, transform .2s; z-index: 2147483600; }
    .dr-toast.dr-show { opacity: 1; transform: translateY(0); }

    /* fallback modal */
    .dr-modal { position: fixed; inset: 0; background: rgba(9,9,11,.45); display: grid; place-items: center; z-index: 2147483647; }
    .dr-modal-box { background: var(--dr-bg); color: var(--dr-text); padding: 18px; border-radius: 14px;
      width: min(560px, 92vw); box-shadow: var(--dr-shadow-pop); }
    .dr-modal-box p { margin: 0 0 10px; font-size: 13px; color: var(--dr-text-soft); }`;
    document.head.append(el("style", { text: css }));
  }

  function init() {
    const meta = window.diagramMeta || { version: "v?", file: "" };
    let seq = 0;
    const comments = []; // { id, target: string|null, text }

    injectStyles();

    // --- sidebar skeleton ---
    const pill = el("span", { class: "dr-pill", text: meta.version });
    const sub = el("div", { class: "dr-sub", text: "Click an element to comment" });
    const listEl = el("div", { class: "dr-list", role: "list" });
    const copyBtn = el("button", { class: "dr-btn dr-btn-primary dr-btn-block", type: "button", disabled: "", text: "Copy for Claude" });
    const globalBtn = el("button", { class: "dr-btn dr-btn-block", type: "button", text: "Comment on whole diagram" });
    const sidebar = el("aside", { id: "dr-sidebar", onClick: (e) => e.stopPropagation() },
      el("div", { class: "dr-head" },
        el("div", { class: "dr-head-row" }, el("div", { class: "dr-title", text: "Review" }), pill),
        sub,
      ),
      listEl,
      el("div", { class: "dr-foot" }, globalBtn, copyBtn),
    );

    // --- composer ---
    let composerTarget = null;
    const compTargetEl = el("div", { class: "dr-comp-target" });
    const compInput = el("textarea", { class: "dr-input", placeholder: "Add a comment…", "aria-label": "Comment text" });
    const compAdd = el("button", { class: "dr-btn dr-btn-primary", type: "button", text: "Add" });
    const compCancel = el("button", { class: "dr-btn", type: "button", text: "Cancel" });
    const composer = el("div", { id: "dr-composer", hidden: "", onClick: (e) => e.stopPropagation() },
      compTargetEl, compInput,
      el("div", { class: "dr-comp-actions" }, compCancel, compAdd),
    );

    function openComposer(target, x, y) {
      composerTarget = target;
      compTargetEl.classList.toggle("dr-global", target == null);
      compTargetEl.textContent = target == null ? "Whole diagram" : target;
      compInput.value = "";
      composer.hidden = false;
      const w = 300, h = composer.offsetHeight || 150;
      const lx = Math.min(Math.max(12, x), window.innerWidth - w - 360);
      const ty = Math.min(Math.max(12, y), window.innerHeight - h - 12);
      composer.style.left = Math.max(12, lx) + "px";
      composer.style.top = Math.max(12, ty) + "px";
      compInput.focus();
    }
    function closeComposer() { composer.hidden = true; composerTarget = null; }
    function submitComposer() {
      const text = compInput.value.trim();
      if (text) { comments.push({ id: ++seq, target: composerTarget, text }); render(); }
      closeComposer();
    }
    compAdd.addEventListener("click", submitComposer);
    compCancel.addEventListener("click", closeComposer);
    compInput.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submitComposer();
      else if (e.key === "Escape") closeComposer();
    });

    // --- rendering ---
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

    function render() {
      const order = pinOrder();
      const numberOf = (t) => order.indexOf(t) + 1;

      // cards
      listEl.replaceChildren();
      if (!comments.length) {
        listEl.append(el("div", { class: "dr-empty" },
          el("div", { class: "dr-empty-title", text: "No comments yet" }),
          el("div", { class: "dr-empty-body", text: "Click any element in the diagram to leave a comment, or comment on the whole diagram below." }),
        ));
      } else {
        for (const c of comments) {
          const isGlobal = c.target == null;
          const badge = el("span", { class: "dr-badge" + (isGlobal ? " dr-global" : ""), text: isGlobal ? "◇" : String(numberOf(c.target)) });
          const chip = el("span", { class: "dr-chip", text: isGlobal ? "Whole diagram" : c.target });
          const del = el("button", { class: "dr-del", type: "button", title: "Delete", "aria-label": "Delete comment", text: "×",
            onClick: (e) => { e.stopPropagation(); const i = comments.indexOf(c); if (i >= 0) comments.splice(i, 1); render(); } });
          const card = el("div", { class: "dr-card", role: "listitem",
            onMouseenter: () => setActive(c.target, true), onMouseleave: () => setActive(c.target, false) },
            el("div", { class: "dr-card-top" }, badge, chip),
            el("div", { class: "dr-card-text", text: c.text }),
            del,
          );
          card.dataset.target = c.target == null ? "" : c.target;
          listEl.append(card);
        }
      }

      // counter
      sub.textContent = comments.length ? `${comments.length} ${plural(comments.length)}` : "Click an element to comment";
      copyBtn.disabled = comments.length === 0;

      // element markers
      const commented = new Set(order);
      for (const node of document.querySelectorAll("[data-id]"))
        node.classList.toggle("dr-commented", commented.has(node.getAttribute("data-id")));

      // pins
      for (const p of document.querySelectorAll(".dr-pin")) p.remove();
      order.forEach((target, i) => {
        const pin = el("button", { class: "dr-pin", type: "button", text: String(i + 1),
          onMouseenter: () => setActive(target, true), onMouseleave: () => setActive(target, false),
          onClick: (e) => { e.stopPropagation(); focusCard(target); } });
        pin.dataset.target = target;
        document.body.append(pin);
      });
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
    }

    function focusCard(target) {
      for (const card of listEl.querySelectorAll(".dr-card")) {
        if (card.dataset.target === target) {
          card.scrollIntoView({ block: "nearest", behavior: "smooth" });
          card.animate(
            [{ background: "color-mix(in srgb, var(--dr-accent) 16%, transparent)" }, { background: "transparent" }],
            { duration: 900, easing: "ease-out" },
          );
          break;
        }
      }
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
      const ta = el("textarea", { class: "dr-input", rows: "10", readonly: "", "aria-label": "Feedback to copy" });
      ta.value = text;
      const close = el("button", { class: "dr-btn dr-btn-primary", type: "button", text: "Close" });
      const modal = el("div", { class: "dr-modal" },
        el("div", { class: "dr-modal-box" },
          el("p", { text: "Copy manually (Ctrl/⌘ + C), then paste into your Claude chat:" }),
          ta,
          el("div", { class: "dr-comp-actions" }, close),
        ),
      );
      close.addEventListener("click", () => modal.remove());
      modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
      document.body.append(modal);
      ta.focus(); ta.select();
    }

    // --- wire up ---
    globalBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const r = globalBtn.getBoundingClientRect();
      openComposer(null, r.left - 312, r.top - 40);
    });
    copyBtn.addEventListener("click", copyForClaude);
    document.addEventListener("click", closeComposer);
    window.addEventListener("resize", layoutPins);
    window.addEventListener("scroll", layoutPins, { passive: true });

    for (const node of document.querySelectorAll("[data-id]")) {
      node.classList.add("dr-target");
      node.addEventListener("click", (e) => {
        e.stopPropagation();
        openComposer(node.getAttribute("data-id"), e.clientX + 16, e.clientY);
      });
    }

    document.body.append(sidebar, composer);
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
