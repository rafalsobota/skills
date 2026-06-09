# diagram-review Skill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code skill that renders a diagram as an HTML file with a click-to-comment overlay, opens it, and reads back feedback the user pastes into the conversation — replacing the entire MCP/socket/Electrobun loop.

**Architecture:** Three skill files: a tiny `template.html` (SVG slot + `<script src="overlay.js">`), a shared `overlay.js` (CSS + JS, classic IIFE) copied once into the output folder, and `SKILL.md` (instructions). Per iteration Claude generates SVG, copies `overlay.js` into the output dir (idempotent), copies the template, fills the SVG/version/file slots via Edit, and runs `open`. The user clicks elements, comments, hits "Kopiuj dla Claude", and pastes a Markdown block back. No server, no sockets, no native window, no build, no runtime deps.

**Tech Stack:** Plain HTML/CSS/JS (browser), macOS `open`, bash for version detection.

> **Status (2026-06-09):** Tasks 1–3 implemented and verified end-to-end (the user generated `diagram-v1.html`, clicked elements + a line edge, added comments, and pasted back a correctly-formatted feedback block). Task 4 (decommission old stack) is pending the user's go-ahead.

> **Design evolution captured here:** the artifact started as a single self-contained HTML (CSS+JS inlined) and was changed to a shared external `overlay.js` so that N diagrams don't each duplicate ~10 KB. External script is a **classic** `<script src>` (not `type="module"`) because ES modules are blocked by CORS on `file://`. Spec `2026-06-09-diagram-review-copy-paste-design.md` reflects the final design.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `.claude/skills/diagram-review/template.html` | Tiny skeleton: placeholders `{{VERSION}}`, `{{FILE}}`, slot `<!-- SVG -->`, and `<script src="overlay.js">`. ~10 lines. |
| `.claude/skills/diagram-review/overlay.js` | Shared overlay — injects CSS, scans `[data-id]`, popover + comment list, `buildFeedbackMarkdown`, clipboard with `<textarea>` fallback. Classic IIFE, no `import/export`, no `innerHTML` on user data. |
| `.claude/skills/diagram-review/SKILL.md` | Trigger + per-iteration workflow for Claude. |

## Testing approach

The deliverable is a static asset (`overlay.js`) + a tiny template + instructions. Bun ships no DOM and adding jsdom would contradict "zero deps", so verification is: (a) `node --check overlay.js` for syntax, (b) a deterministic `buildFeedbackMarkdown` check in `node -e`, (c) structural checks on a generated file, and (d) a real browser round-trip (open, click, comment, copy, paste back). All four passed.

---

### Task 1: Create `template.html` and `overlay.js` — DONE

**Files:**
- Create: `.claude/skills/diagram-review/template.html`
- Create: `.claude/skills/diagram-review/overlay.js`

- [x] **Step 1: Write `template.html`** — the tiny skeleton referencing `./overlay.js`, with `window.diagramMeta = { version: "{{VERSION}}", file: "{{FILE}}" }` and the `<!-- SVG -->` slot.

- [x] **Step 2: Write `overlay.js`** — classic IIFE. Guards `if (typeof document === "undefined") return;`. Defines `el()` (createElement helper, no innerHTML), `plural()`, `buildFeedbackMarkdown(meta, comments)`, `injectStyles()`, and `init()` (toolbar with counter + "Komentarz do całości" + "Kopiuj dla Claude", per-element click → popover → comment list, element highlight on comment, clipboard copy with fallback modal). Runs `init` on `DOMContentLoaded` or immediately.

- [x] **Step 3: Syntax check**

Run: `node --check .claude/skills/diagram-review/overlay.js`
Expected: exit 0. ✓

- [x] **Step 4: Deterministic format check**

Run a `node -e` that defines `buildFeedbackMarkdown` and asserts:
- `[{target:"box-a",text:" test A "},{target:null,text:"test całość"}]` →
  ``## Feedback do diagramu v1 (plik: diagram-v1.html)\n\n- **[element: box-a]** test A\n- **[całość]** test całość\n``
- `[]` → header + `\n\n_(brak komentarzy)_\n`
Expected: both PASS. ✓

- [x] **Step 5: Structural smoke test** — generate a `diagram-v1.html` from a sample SVG (with `data-id` nodes and a `data-id` line edge) and assert: 0 placeholders left, exactly 1 `src="overlay.js"`, 3 `data-id` elements, `overlay.js` defines `buildFeedbackMarkdown`, HTML does NOT inline the JS (0 matches), `diagramMeta` filled. HTML ≈ 0.9 KB, overlay.js ≈ 10 KB. ✓

### Task 2: Create `SKILL.md` — DONE

**Files:**
- Create: `.claude/skills/diagram-review/SKILL.md`

- [x] **Step 1: Write the workflow** — frontmatter `name`/`description`; per-iteration steps: generate SVG with stable `data-id`s; pick output dir (`${TMPDIR:-/tmp}/diagram-review`, honoring user prefs) and next version via the find-based snippet below; `cp -f overlay.js` into the dir; `cp template.html` to `$OUT` and Edit the three slots; `open "$OUT"`; parse the pasted `## Feedback do diagramu vN …` block and regenerate as `v(N+1)`.

Version detection (robust in bash AND zsh — `ls *.glob` errors on empty dirs in zsh):

```bash
OUTDIR="${TMPDIR:-/tmp}/diagram-review"; mkdir -p "$OUTDIR"
cp -f "$SKILL_DIR/overlay.js" "$OUTDIR/overlay.js"
LAST=$(find "$OUTDIR" -maxdepth 1 -name 'diagram-v*.html' 2>/dev/null \
     | sed -n 's#.*/diagram-v\([0-9]\{1,\}\)\.html#\1#p' | sort -n | tail -1)
N=$(( ${LAST:-0} + 1 )); OUT="$OUTDIR/diagram-v$N.html"
```

- [x] **Step 2: Verify version detection in zsh** — empty dir → `next=1`; after `v1,v2,v10` → `next=11` (numeric sort). ✓

### Task 3: End-to-end round trip — DONE

- [x] Generated `diagram-v1.html`, opened it in the real browser, clicked `box-a`/`box-b`/`edge-ab`, added an element comment + a whole-diagram comment, clicked "Kopiuj dla Claude", and pasted the block back into the conversation. The pasted Markdown matched the contract exactly, confirming both directions of the loop. ✓

---

### Task 4: Decommission the old MCP/socket/Electrobun stack — PENDING (gated)

> **Gate:** only after the user confirms the skill fully replaces the old loop. Destructive.

**Files:**
- Delete: `viewer-app/` (entire directory)
- Delete: transport/MCP modules under `src/` (`unix-bridge.ts`, `socket-writer.ts`, `wire.ts`, `server.ts`, `mcp-server.ts`, `diagram-service.ts`, `version-store.ts`, `feedback-buffer.ts`, `launcher-path.ts`, `types.ts` if unreferenced)
- Delete: matching `test/*.test.ts` + `test/fake-bridge.ts`
- Delete: `.mcp.json`
- Modify: `package.json` (drop `start`, `build:viewer`, and `@modelcontextprotocol/sdk`/`zod` if unused)
- Keep: `docs/superpowers/specs/*` and `docs/superpowers/plans/*`

- [ ] **Step 1:** Get the user's go-ahead.
- [ ] **Step 2:** `git rm -r viewer-app` and `git rm` the transport modules + their tests + `.mcp.json` (run `ls src test` first; remove only transport/MCP files).
- [ ] **Step 3:** Trim `package.json`, then `bun install` to refresh the lockfile.
- [ ] **Step 4:** `bun run typecheck` (clean, or "no inputs" if all TS removed).
- [ ] **Step 5:** `git commit -m "chore: remove MCP/socket/Electrobun stack, superseded by diagram-review skill"`.

---

## Self-Review

- **Spec coverage:** 3-file skill ✓; shared `overlay.js` + disk rationale ✓; classic-script/CORS rationale ✓; default temp location + find-based version detection ✓; `data-id` targeting (element + whole-diagram only, no emoji) ✓; copy-paste Markdown contract ✓ (unit + real round trip); clipboard fallback ✓; old-stack removal ✓ (Task 4, gated).
- **Placeholders:** none — verification commands have expected output; the actual file contents live in the committed skill, not duplicated here.
- **Consistency:** `buildFeedbackMarkdown`, `data-id`, `{{VERSION}}`/`{{FILE}}`/`<!-- SVG -->`, `diagram-vN.html`, `${TMPDIR:-/tmp}/diagram-review`, find-based version snippet — consistent across tasks and the implemented files.
