# diagram-review Skill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Code skill that renders a diagram as a single self-contained HTML file with a commenting overlay, opens it, and reads back feedback pasted by the user — replacing the entire MCP/socket/Electrobun loop.

**Architecture:** Two files in the skill: `template.html` (self-contained — SVG slot + CSS + JS inlined) and `SKILL.md` (instructions). Per iteration Claude generates SVG, copies the template, fills the SVG/version/file slots via Edit, saves `diagram-vN.html` to a default temp dir, and runs `open`. The user clicks elements, comments, hits "Kopiuj dla Claude", and pastes a Markdown block back into the conversation. No server, no sockets, no native window, no build, no runtime deps.

**Tech Stack:** Plain HTML/CSS/JS (browser), macOS `open`, bash for version detection. Repo runtime is Bun, but the skill itself needs nothing beyond a browser.

> **Note — refines spec `2026-06-09-diagram-review-copy-paste-design.md`:** the spec described 3 skill files (`SKILL.md`, `overlay.js`, `template.html`) assembled via inlining. This plan collapses that to a single self-contained `template.html` (JS+CSS already inlined) per the user's simplification — `overlay.js` and any assemble step are dropped. The spec will be synced to match.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `.claude/skills/diagram-review/template.html` | The self-contained artifact skeleton: placeholders `{{VERSION}}`, `{{FILE}}`, and `<!-- SVG -->`; inlined `<style>`; inlined `<script type="module">` building the overlay. |
| `.claude/skills/diagram-review/SKILL.md` | Trigger + workflow instructions for Claude: generate SVG, pick version, copy+fill template, open, parse pasted feedback, iterate. |

Decommissioning of the old stack (`viewer-app/`, transport `src/*`, `.mcp.json`) is the final task, gated behind a working end-to-end verification.

## Testing approach

The deliverable is a static HTML asset plus instructions. There is no pure module to import (the JS lives inline so the file is self-contained and copyable). Bun ships no DOM, and adding jsdom/happy-dom would contradict the "zero deps" goal. Therefore verification is a **documented manual smoke test** (open a generated file, click an element, add a comment, copy, confirm the clipboard text matches the expected Markdown). Each task below states its exact verification steps and expected output.

---

### Task 1: Create the self-contained `template.html`

**Files:**
- Create: `.claude/skills/diagram-review/template.html`

- [ ] **Step 1: Write the template file**

Create `.claude/skills/diagram-review/template.html` with exactly this content. The JS builds all UI via `createElement`/`textContent` (no `innerHTML` on any value — this also passes the repo's security hook). The SVG slot is the HTML comment `<!-- SVG -->`, which Claude replaces via Edit.

```html
<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Diagram {{VERSION}}</title>
<style>
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
    width: min(560px, 92vw); box-shadow: 0 12px 40px rgba(0,0,0,.3); }
</style>
</head>
<body>
<script>window.diagramMeta = { version: "{{VERSION}}", file: "{{FILE}}" };</script>
<main id="stage">
<!-- SVG -->
</main>
<script type="module">
const meta = window.diagramMeta || { version: "v?", file: "" };
const comments = [];

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
</script>
</body>
</html>
```

- [ ] **Step 2: Smoke-test the template with a sample SVG**

Create a throwaway filled copy and open it (this simulates what the skill will do):

```bash
OUT="${TMPDIR:-/tmp}/diagram-review/diagram-v1.html"
mkdir -p "$(dirname "$OUT")"
sed -e 's/{{VERSION}}/v1/g' -e 's/{{FILE}}/diagram-v1.html/g' \
  .claude/skills/diagram-review/template.html > "$OUT"
# inject a tiny sample SVG into the slot
python3 - "$OUT" <<'PY'
import sys
p = sys.argv[1]
svg = '''<svg xmlns="http://www.w3.org/2000/svg" width="360" height="140">
  <rect data-id="box-a" x="20" y="20" width="140" height="80" rx="8" fill="#dbeafe" stroke="#2563eb"/>
  <text x="90" y="65" text-anchor="middle">A</text>
  <rect data-id="box-b" x="200" y="20" width="140" height="80" rx="8" fill="#dcfce7" stroke="#16a34a"/>
  <text x="270" y="65" text-anchor="middle">B</text>
</svg>'''
open(p, "w").write(open(p).read().replace("<!-- SVG -->", svg))
PY
open "$OUT"
```

Expected: a browser tab opens showing two boxes and a bottom toolbar reading `v1` / `brak komentarzy` with a disabled "Kopiuj dla Claude" button.

- [ ] **Step 3: Manually verify the overlay behavior**

In the opened tab:
1. Hover box A → blue outline appears.
2. Click box A → popover opens labeled "Element: box-a"; type "test A", click "Dodaj". Counter shows "1 komentarz", box A gets a green dashed outline, copy button enabled.
3. Click "Komentarz do całości" → popover labeled "Komentarz do całości"; type "test całość", Dodaj. Counter "2 komentarze".
4. Click "Kopiuj dla Claude" → toast "Skopiowano ✓"; paste into a text editor and confirm it equals:

```
## Feedback do diagramu v1 (plik: diagram-v1.html)

- **[element: box-a]** test A
- **[całość]** test całość
```

(If the browser blocks clipboard on `file://`, the fallback modal appears with the same text selected — that is also a pass.)

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/diagram-review/template.html
git commit -m "feat: diagram-review self-contained HTML template with commenting overlay"
```

---

### Task 2: Create `SKILL.md`

**Files:**
- Create: `.claude/skills/diagram-review/SKILL.md`

- [ ] **Step 1: Write the skill file**

Create `.claude/skills/diagram-review/SKILL.md` with this content:

````markdown
---
name: diagram-review
description: Use when the user wants to see, review, or iterate on a diagram (architecture, graph, flow, state machine, data model) and leave comments on its parts. Renders an SVG into a self-contained HTML file with a click-to-comment overlay, opens it in the browser, and reads back the feedback the user pastes into the conversation.
---

# diagram-review

Render a diagram the user can annotate, then iterate from their pasted feedback.
Claude owns the graph; the HTML only displays it and collects comments. The return
path is the user copying a Markdown block and pasting it back — there is no server.

## Per-iteration workflow

1. **Generate the SVG.** Produce a complete `<svg>…</svg>`. Every element the user
   might comment on MUST carry a stable `data-id` (readable kebab-case, e.g.
   `data-id="auth-service"`). Reuse the same `data-id` across versions for the same
   concept so feedback stays traceable. Make the SVG self-sizing (`width`/`height`
   or `viewBox`); it will be capped to `max-width:100%`.

2. **Pick the output path and version.** Default directory is
   `${TMPDIR:-/tmp}/diagram-review` (honor any user preference, e.g. a CLAUDE.md
   rule to keep artifacts in `./diagrams/`). The version is the next free `vN`:

   ```bash
   OUTDIR="${TMPDIR:-/tmp}/diagram-review"; mkdir -p "$OUTDIR"
   N=$(( $(ls "$OUTDIR"/diagram-v*.html 2>/dev/null \
        | sed -n 's#.*/diagram-v\([0-9]\{1,\}\)\.html#\1#p' \
        | sort -n | tail -1) + 0 )); N=$((N+1))
   OUT="$OUTDIR/diagram-v$N.html"
   echo "$OUT"
   ```

3. **Build the file from the template.** Copy the template, then fill the three
   slots. Do NOT retype the template's CSS/JS — only substitute:

   ```bash
   cp "$(dirname "$0")/template.html" "$OUT"   # or the skill's template.html path
   ```

   Then use Edit on `$OUT`:
   - replace both `{{VERSION}}` with `vN` (replace_all),
   - replace `{{FILE}}` with `diagram-vN.html`,
   - replace the single line `<!-- SVG -->` with the full SVG markup.

   (You generated the SVG yourself, so emitting it in the Edit is free; the heavy
   CSS/JS already sits in the copied file untouched.)

4. **Open it.** `open "$OUT"` (macOS). Tell the user: click any element to comment,
   use "Komentarz do całości" for whole-diagram notes, then "Kopiuj dla Claude" and
   paste the result back here.

5. **Iterate from pasted feedback.** The user pastes a block like:

   ```
   ## Feedback do diagramu v2 (plik: diagram-v2.html)

   - **[element: auth-service]** nie powinno zależeć od cache
   - **[całość]** rozbij na dwie warstwy
   ```

   The header tells you the base version. Apply the comments, regenerate the SVG as
   `v(N+1)`, and repeat from step 2. Keep `data-id`s stable for unchanged concepts.

## Notes

- The generated HTML is fully self-contained (CSS + JS inlined) — it works offline,
  needs no server, and can be moved or shared as a single file.
- Comment targets are only "a specific element" (`data-id`) or "the whole diagram".
  There is no edge/region/emoji taxonomy — keep it simple.
- If the user has no `open` (non-macOS), give them the file path to open manually.
````

- [ ] **Step 2: Sanity-check the version-detection snippet**

```bash
OUTDIR="${TMPDIR:-/tmp}/diagram-review"; mkdir -p "$OUTDIR"; touch "$OUTDIR/diagram-v1.html" "$OUTDIR/diagram-v2.html"
N=$(( $(ls "$OUTDIR"/diagram-v*.html 2>/dev/null | sed -n 's#.*/diagram-v\([0-9]\{1,\}\)\.html#\1#p' | sort -n | tail -1) + 0 )); echo "next=$((N+1))"
```

Expected: `next=3`

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/diagram-review/SKILL.md
git commit -m "feat: diagram-review SKILL.md workflow instructions"
```

---

### Task 3: End-to-end dry run through the skill

**Files:** none (verification only).

- [ ] **Step 1: Clear the temp dir for a clean run**

```bash
rm -f "${TMPDIR:-/tmp}/diagram-review/"diagram-v*.html
```

- [ ] **Step 2: Follow SKILL.md by hand for a real request**

Pick a small real diagram (e.g. "render the auth flow"). Execute the SKILL.md steps:
generate SVG with `data-id`s, compute `OUT` (expect `diagram-v1.html`), `cp` the
template, Edit the three slots, `open "$OUT"`.

Expected: the browser shows the diagram with a working toolbar; the file at
`${TMPDIR:-/tmp}/diagram-review/diagram-v1.html` is self-contained (grep confirms the
JS is inlined, not referenced):

```bash
grep -c "buildFeedbackMarkdown" "${TMPDIR:-/tmp}/diagram-review/diagram-v1.html"   # >= 1
grep -c "<!-- SVG -->" "${TMPDIR:-/tmp}/diagram-review/diagram-v1.html"            # 0 (placeholder consumed)
grep -c "{{VERSION}}" "${TMPDIR:-/tmp}/diagram-review/diagram-v1.html"             # 0
```

- [ ] **Step 3: Simulate one feedback round**

In the browser, add one element comment and one global comment, click "Kopiuj dla
Claude", and paste the block back. Confirm Claude can read the version + targets from
the pasted Markdown and that a regenerate would land at `diagram-v2.html` (the
version snippet now returns `next=2`).

This closes the loop end-to-end. No code change — if anything misbehaves, fix the
relevant file in Task 1/2 and re-commit.

---

### Task 4: Decommission the old MCP/socket/Electrobun stack

**Files:**
- Delete: `viewer-app/` (entire directory)
- Delete: `src/unix-bridge.ts`, `src/socket-writer.ts`, `src/wire.ts`, `src/server.ts`, `src/mcp-server.ts`, `src/diagram-service.ts`, `src/version-store.ts`, `src/feedback-buffer.ts`, `src/launcher-path.ts`, and any remaining transport-only files under `src/`
- Delete: corresponding `test/*.test.ts` for the removed modules
- Delete: `.mcp.json` (the `sedno` MCP server entry)
- Modify: `package.json` (drop `start`, `build:viewer`, and MCP-only deps `@modelcontextprotocol/sdk`; keep what the skill workflow needs — likely nothing runtime)
- Keep: `docs/superpowers/specs/*` and `docs/superpowers/plans/*` as historical record

> **Gate:** only do this AFTER Task 3 passes and the user confirms the skill fully replaces the old loop. This is destructive and removes the previous architecture.

- [ ] **Step 1: Confirm the skill works end-to-end (Task 3 green) and get the user's go-ahead.**

- [ ] **Step 2: Remove the viewer app and transport code**

```bash
git rm -r viewer-app
git rm src/unix-bridge.ts src/socket-writer.ts src/wire.ts src/server.ts \
       src/mcp-server.ts src/diagram-service.ts src/version-store.ts \
       src/feedback-buffer.ts src/launcher-path.ts
git rm test/unix-bridge.test.ts test/socket-writer.test.ts test/wire.test.ts \
       test/mcp-server.test.ts test/diagram-service.test.ts test/version-store.test.ts \
       test/feedback-buffer.test.ts test/launcher-path.test.ts test/fake-bridge.ts
git rm .mcp.json
```

(Adjust the list to whatever actually remains — run `ls src test` first and remove
only transport/MCP files. If `src/types.ts` is referenced solely by removed modules,
remove it too.)

- [ ] **Step 3: Trim `package.json`**

Open `package.json`, remove the `start` and `build:viewer` scripts and the
`@modelcontextprotocol/sdk` + `zod` dependencies if nothing else uses them. Keep
`test`/`typecheck` only if any code remains to test. Then:

```bash
bun install   # refresh lockfile
```

- [ ] **Step 4: Verify the repo still type-checks (if any TS remains)**

```bash
bun run typecheck 2>/dev/null && echo "typecheck ok" || echo "no TS left / check output"
```

Expected: clean, or a clear "no inputs" if all TS was removed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove MCP/socket/Electrobun stack, superseded by diagram-review skill"
```

---

## Self-Review

- **Spec coverage:** skill as 2 self-contained files ✓ (Tasks 1–2); default temp location + version detection ✓ (Task 2); `data-id` targeting, element + whole-diagram only, no emoji ✓ (Task 1 JS + Task 2 notes); copy-paste Markdown contract ✓ (Task 1 `buildFeedbackMarkdown`, verified Task 1 Step 3 / Task 3); clipboard fallback ✓ (Task 1 `showFallback`); removal of old stack ✓ (Task 4). Divergence from spec's 3-file design is called out in the header and will be synced.
- **Placeholders:** none — full code for template.html and SKILL.md is inline; all verification commands have expected output.
- **Consistency:** function/ids names match across tasks (`buildFeedbackMarkdown`, `data-id`, `{{VERSION}}`/`{{FILE}}`/`<!-- SVG -->`, `diagram-vN.html`, `${TMPDIR:-/tmp}/diagram-review`).
