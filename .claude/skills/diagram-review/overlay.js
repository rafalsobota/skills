// Współdzielona nakładka do komentowania diagramu.
// KLASYCZNY skrypt (nie moduł) — ładowany przez <script src="overlay.js"> z file://
// bez problemów CORS. Kopiowany raz do folderu docelowego, referowany przez każdy
// diagram-vN.html. Cała logika + CSS tutaj, więc pliki HTML są malutkie.
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

  function plural(n) {
    if (n === 1) return "komentarz";
    const t = n % 10, h = n % 100;
    return (t >= 2 && t <= 4 && (h < 10 || h >= 20)) ? "komentarze" : "komentarzy";
  }

  function buildFeedbackMarkdown(meta, comments) {
    const header = `## Feedback do diagramu ${meta.version} (plik: ${meta.file})`;
    if (!comments.length) return `${header}\n\n_(brak komentarzy)_\n`;
    const lines = comments.map((c) => {
      const tag = c.target == null ? "[całość]" : `[element: ${c.target}]`;
      return `- **${tag}** ${String(c.text).trim()}`;
    });
    return `${header}\n\n${lines.join("\n")}\n`;
  }

  function injectStyles() {
    const css = `
    :root { color-scheme: light dark; }
    body { margin: 0; padding-bottom: 230px; font: 14px/1.45 system-ui, -apple-system, sans-serif; }
    #stage { padding: 24px; }
    #stage svg { max-width: 100%; height: auto; }
    .dr-target { cursor: pointer; transition: filter .12s; }
    .dr-target:hover { outline: 2px solid #2563eb; outline-offset: 1px; }
    .dr-has-comment { outline: 2px dashed #16a34a; outline-offset: 1px; }
    #dr-toolbar { position: fixed; left: 0; right: 0; bottom: 0; background: Canvas;
      border-top: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
      box-shadow: 0 -4px 16px rgba(0,0,0,.08); max-height: 210px; display: flex;
      flex-direction: column; z-index: 9999; }
    .dr-bar { display: flex; align-items: center; gap: 10px; padding: 8px 12px; }
    #dr-meta { font-weight: 700; padding: 2px 8px; border-radius: 999px;
      background: color-mix(in srgb, CanvasText 10%, transparent); }
    #dr-counter { opacity: .7; }
    .dr-spacer { flex: 1; }
    .dr-btn { font: inherit; padding: 6px 12px; border-radius: 8px;
      border: 1px solid color-mix(in srgb, CanvasText 22%, transparent);
      background: Canvas; color: CanvasText; cursor: pointer; }
    .dr-btn:hover { background: color-mix(in srgb, CanvasText 8%, transparent); }
    .dr-btn:disabled { opacity: .45; cursor: default; }
    .dr-primary { background: #2563eb; border-color: #2563eb; color: #fff; }
    .dr-primary:hover { background: #1d4ed8; }
    #dr-list { margin: 0; padding: 0 12px 10px; list-style: none; overflow: auto; }
    #dr-list li { display: flex; align-items: center; gap: 8px; padding: 4px 0;
      border-top: 1px solid color-mix(in srgb, CanvasText 10%, transparent); }
    .dr-tag { font-weight: 600; flex: 0 0 auto; max-width: 160px; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap; padding: 1px 8px; border-radius: 999px;
      background: color-mix(in srgb, #2563eb 18%, transparent); }
    .dr-txt { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dr-del { border: none; background: none; cursor: pointer; font-size: 18px;
      line-height: 1; opacity: .5; }
    .dr-del:hover { opacity: 1; }
    #dr-popover { position: fixed; width: 280px; background: Canvas;
      border: 1px solid color-mix(in srgb, CanvasText 22%, transparent); border-radius: 10px;
      box-shadow: 0 8px 28px rgba(0,0,0,.18); padding: 10px; z-index: 10000; }
    #dr-popover[hidden] { display: none; }
    .dr-pop-target { font-weight: 600; margin-bottom: 6px; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap; }
    .dr-input { width: 100%; box-sizing: border-box; font: inherit; padding: 6px;
      border-radius: 6px; border: 1px solid color-mix(in srgb, CanvasText 22%, transparent);
      background: Canvas; color: CanvasText; resize: vertical; }
    .dr-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
    .dr-toast { position: fixed; left: 50%; bottom: 240px; transform: translate(-50%, 10px);
      background: #111; color: #fff; padding: 8px 14px; border-radius: 8px; opacity: 0;
      transition: all .25s; z-index: 10001; }
    .dr-toast.dr-show { opacity: 1; transform: translate(-50%, 0); }
    .dr-modal { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: grid;
      place-items: center; z-index: 10002; }
    .dr-modal-box { background: Canvas; color: CanvasText; padding: 16px; border-radius: 12px;
      width: min(560px, 92vw); box-shadow: 0 12px 40px rgba(0,0,0,.3); }`;
    document.head.append(el("style", { text: css }));
  }

  function init() {
    const meta = window.diagramMeta || { version: "v?", file: "" };
    const comments = [];

    injectStyles();

    // --- toolbar ---
    const counter = el("span", { id: "dr-counter", text: "brak komentarzy" });
    const list = el("ul", { id: "dr-list" });
    const globalBtn = el("button", { class: "dr-btn", text: "Komentarz do całości" });
    const copyBtn = el("button", { class: "dr-btn dr-primary", disabled: "", text: "Kopiuj dla Claude" });
    const toolbar = el("div", { id: "dr-toolbar", onClick: (e) => e.stopPropagation() },
      el("div", { class: "dr-bar" },
        el("span", { id: "dr-meta", text: meta.version }),
        counter,
        el("span", { class: "dr-spacer" }),
        globalBtn,
        copyBtn,
      ),
      list,
    );

    // --- popover ---
    let current = null;
    const popTarget = el("div", { class: "dr-pop-target" });
    const popInput = el("textarea", { class: "dr-input", rows: "3", placeholder: "Twój komentarz…" });
    const popAdd = el("button", { class: "dr-btn dr-primary", text: "Dodaj" });
    const popCancel = el("button", { class: "dr-btn", text: "Anuluj" });
    const popover = el("div", { id: "dr-popover", hidden: "", onClick: (e) => e.stopPropagation() },
      popTarget, popInput,
      el("div", { class: "dr-actions" }, popCancel, popAdd),
    );

    function openPopover(target, x, y) {
      current = target;
      popTarget.textContent = target == null ? "Komentarz do całości" : `Element: ${target}`;
      popInput.value = "";
      popover.hidden = false;
      const left = Math.min(Math.max(8, x), window.innerWidth - 288);
      const top = Math.min(Math.max(8, y), window.innerHeight - 170);
      popover.style.left = left + "px";
      popover.style.top = top + "px";
      popInput.focus();
    }
    function closePopover() { popover.hidden = true; current = null; }

    function addComment() {
      const text = popInput.value.trim();
      if (text) { comments.push({ target: current, text }); refresh(); }
      closePopover();
    }
    popAdd.addEventListener("click", addComment);
    popCancel.addEventListener("click", closePopover);
    popInput.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") addComment();
      if (e.key === "Escape") closePopover();
    });

    function refresh() {
      counter.textContent = comments.length ? `${comments.length} ${plural(comments.length)}` : "brak komentarzy";
      copyBtn.disabled = comments.length === 0;
      list.replaceChildren();
      const targeted = new Set();
      comments.forEach((c, i) => {
        if (c.target != null) targeted.add(c.target);
        const del = el("button", { class: "dr-del", title: "Usuń", text: "×",
          onClick: (e) => { e.stopPropagation(); comments.splice(i, 1); refresh(); } });
        list.append(el("li", null,
          el("span", { class: "dr-tag", text: c.target == null ? "całość" : c.target }),
          el("span", { class: "dr-txt", text: c.text }),
          del,
        ));
      });
      for (const node of document.querySelectorAll("[data-id]"))
        node.classList.toggle("dr-has-comment", targeted.has(node.getAttribute("data-id")));
    }

    async function copyForClaude() {
      const text = buildFeedbackMarkdown(meta, comments);
      try { await navigator.clipboard.writeText(text); flash("Skopiowano ✓ — wklej do rozmowy z Claude"); }
      catch { showFallback(text); }
    }

    function flash(msg) {
      const t = el("div", { class: "dr-toast", text: msg });
      document.body.append(t);
      setTimeout(() => t.classList.add("dr-show"), 10);
      setTimeout(() => { t.classList.remove("dr-show"); setTimeout(() => t.remove(), 300); }, 2200);
    }

    function showFallback(text) {
      const ta = el("textarea", { class: "dr-input", rows: "10", readonly: "" });
      ta.value = text;
      const close = el("button", { class: "dr-btn dr-primary", text: "Zamknij" });
      const box = el("div", { class: "dr-modal-box" },
        el("p", { text: "Skopiuj ręcznie (Ctrl/⌘ + C), potem wklej do rozmowy z Claude:" }),
        ta,
        el("div", { class: "dr-actions" }, close),
      );
      const modal = el("div", { class: "dr-modal" }, box);
      close.addEventListener("click", () => modal.remove());
      modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
      document.body.append(modal);
      ta.focus(); ta.select();
    }

    // --- wire up ---
    globalBtn.addEventListener("click", (e) => { e.stopPropagation(); openPopover(null, e.clientX, e.clientY); });
    copyBtn.addEventListener("click", copyForClaude);
    document.addEventListener("click", closePopover);
    for (const node of document.querySelectorAll("[data-id]")) {
      node.classList.add("dr-target");
      node.addEventListener("click", (e) => {
        e.stopPropagation();
        openPopover(node.getAttribute("data-id"), e.clientX, e.clientY);
      });
    }
    document.body.append(toolbar, popover);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
