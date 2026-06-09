---
name: whiteboard
description: Use when a wall of text isn't landing and it would be clearer to draw it out — like sketching on an office whiteboard. Also when the user wants to see, point at, or iterate on a diagram (architecture, flow, state machine, data model, dependency map). Renders an SVG as an interactive browser canvas where the user drops pin comments on any element, then reads their pasted feedback back to redraw.
---

# whiteboard

Render a diagram the user can annotate, then iterate from their pasted feedback.
Claude owns the graph; the HTML only displays it and collects comments. The return
path is the user copying a Markdown block and pasting it back — there is no server.

The overlay (CSS + JS) lives in a single shared `overlay.js`, copied once into the
output folder and referenced by every diagram HTML file. So the HTML files stay
tiny — many diagrams share one overlay instead of inlining it each time.

## Per-iteration workflow

Let `SKILL_DIR` be this skill's own directory (where `template.html` and
`overlay.js` sit). Substitute its real absolute path in the commands below.

1. **Generate the SVG.** Produce a complete `<svg>…</svg>`. Every element the user
   might comment on MUST carry a stable `data-id` (readable kebab-case, e.g.
   `data-id="auth-service"`). Reuse the same `data-id` across versions for the same
   concept so feedback stays traceable. Make the SVG self-sizing (`width`/`height`
   or `viewBox`); it is capped to `max-width:100%`.

   **Nodes** (shapes like `<rect>`, `<circle>`) are commentable as-is — give them a
   `data-id`. The pin lands exactly where the user clicks, clamped to the shape.

   **Relations / edges** should ALSO be commentable. Wrap each edge in a
   `<g data-id="rel-…">` containing (a) the visible thin line/arrow and (b) a
   **transparent wide hit-area** on top so the thin line is easy to click:

   ```html
   <g data-id="rel-user-places-order">
     <line x1="…" y1="…" x2="…" y2="…" stroke="transparent" stroke-width="18" stroke-linecap="round"/>
     <line x1="…" y1="…" x2="…" y2="…" stroke="#71717a" stroke-width="1.6" marker-end="url(#arr)"/>
     <!-- optional label rect + text at the midpoint -->
   </g>
   ```

   Anchoring is automatic: shapes (nodes) anchor the pin at their top-right corner;
   groups (`<g>`, i.e. edges) default to the bbox center (= a straight line's
   midpoint). Override per element with `data-anchor="center"` or `data-anchor="corner"`
   if needed. Either way the user can click anywhere on the element to place the pin
   precisely, and drag it later.

2. **Choose a meaningful name.** Pick a short, descriptive kebab-case name for the
   diagram based on its content (e.g. `auth-flow`, `microservices-overview`,
   `payment-state-machine`). For the first version use the bare name; for iterations
   append `-v2`, `-v3` etc. only when you actually produce a new version in response
   to feedback. Default output directory is `${TMPDIR:-/tmp}/whiteboard`:

   ```bash
   OUTDIR="${TMPDIR:-/tmp}/whiteboard"; mkdir -p "$OUTDIR"
   cp -f "$SKILL_DIR/overlay.js" "$OUTDIR/overlay.js"   # refresh shared overlay (idempotent)
   NAME="auth-flow"          # ← chosen by Claude, bare name or name-v2, name-v3, …
   OUT="$OUTDIR/$NAME.html"
   ```

3. **Build the file from the template.** Copy the template, then fill the three
   slots. Do NOT retype the overlay — it is the separate `overlay.js`:

   ```bash
   cp "$SKILL_DIR/template.html" "$OUT"
   ```

   Then use Edit on `$OUT`:
   - replace both `{{VERSION}}` with `$NAME` (replace_all),
   - replace `{{FILE}}` with `$NAME.html`,
   - replace the single line `<!-- SVG -->` with the full SVG markup.

   The `<script src="overlay.js">` in the template resolves next to the HTML, where
   step 2 copied `overlay.js`.

4. **Open it.** `open "$OUT"` (macOS). The diagram sits on an infinite canvas:
   drag the background to pan, scroll / pinch to zoom, double-click the background
   to reset the view. Click any element (node or relation) to drop a teardrop pin
   exactly where you click and type a comment; hover a pin to read it, click to
   edit, drag its number badge to reposition it within the element. Whole-diagram
   notes and the full comment list live in the floating **Review** panel (bottom-right);
   "Copy for AI" copies the Markdown (the chevron beside it previews the raw text).
   The user pastes that block back here.

5. **Iterate from pasted feedback.** The user pastes a block like:

   ```
   ## Feedback on diagram auth-flow (file: auth-flow.html)

   > split this into two layers

   - **[element: auth-service]** should not depend on cache
   - **[element: gateway]** is this really needed?
   ```

   The leading `>` blockquote (if present) is the whole-diagram note; each `- [element: …]`
   bullet targets one element by its `data-id`.

   The header tells you the base name. Apply the comments, regenerate the SVG as
   `auth-flow-v2` (incrementing the suffix), and repeat from step 2.
   Keep `data-id`s stable for unchanged concepts.

## Notes

- Comment targets are "a specific element" (any `data-id`, whether a node or a
  relation `<g>`) or "the whole diagram" (the Review panel's overall notes).
- The HTML references `./overlay.js`, so a diagram file is only valid alongside the
  `overlay.js` in the same folder (fine for the ephemeral temp dir). It is not a
  standalone single file.
- `overlay.js` is loaded as a classic script (not an ES module) on purpose: ES
  modules are blocked by CORS on `file://`, classic same-folder scripts are not.
- If the user has no `open` (non-macOS), give them the file path to open manually.

## Chat output

Keep the conversation clean — the diagram IS the communication.

**Do NOT:**
- Narrate what you are about to do ("I'll now generate…", "Let me create…")
- Show SVG markup in the chat
- Explain steps as you execute them
- Summarize what you just did

**After opening the diagram**, output exactly one brief line, e.g.:
> auth-flow is open — click any element or relation to comment, then open Review → "Copy for AI" and paste back.

**When iterating from pasted feedback**, apply changes silently and output the same one-liner with the new name (e.g. `auth-flow-v2 is open — …`).

If you have a genuine question for the user (ambiguous intent, missing info), ask it BEFORE generating — not as commentary during or after.
