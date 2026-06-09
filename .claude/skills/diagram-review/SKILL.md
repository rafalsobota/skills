---
name: diagram-review
description: Use when the user wants to see, review, or iterate on a diagram (architecture, graph, flow, state machine, data model) and leave comments on its parts. Renders an SVG into an HTML file with a click-to-comment overlay, opens it in the browser, and reads back the feedback the user pastes into the conversation.
---

# diagram-review

Render a diagram the user can annotate, then iterate from their pasted feedback.
Claude owns the graph; the HTML only displays it and collects comments. The return
path is the user copying a Markdown block and pasting it back — there is no server.

The overlay (CSS + JS) lives in a single shared `overlay.js`, copied once into the
output folder and referenced by every `diagram-vN.html`. So the HTML files stay
tiny — 100 diagrams share one overlay instead of inlining ~10 KB each.

## Per-iteration workflow

Let `SKILL_DIR` be this skill's own directory (where `template.html` and
`overlay.js` sit). Substitute its real absolute path in the commands below.

1. **Generate the SVG.** Produce a complete `<svg>…</svg>`. Every element the user
   might comment on MUST carry a stable `data-id` (readable kebab-case, e.g.
   `data-id="auth-service"`). Reuse the same `data-id` across versions for the same
   concept so feedback stays traceable. Make the SVG self-sizing (`width`/`height`
   or `viewBox`); it is capped to `max-width:100%`.

2. **Pick the output path and version.** Default directory is
   `${TMPDIR:-/tmp}/diagram-review` (honor any user preference, e.g. a CLAUDE.md
   rule to keep artifacts in `./diagrams/`). The version is the next free `vN`:

   ```bash
   OUTDIR="${TMPDIR:-/tmp}/diagram-review"; mkdir -p "$OUTDIR"
   cp -f "$SKILL_DIR/overlay.js" "$OUTDIR/overlay.js"   # refresh shared overlay (idempotent)
   LAST=$(find "$OUTDIR" -maxdepth 1 -name 'diagram-v*.html' 2>/dev/null \
        | sed -n 's#.*/diagram-v\([0-9]\{1,\}\)\.html#\1#p' | sort -n | tail -1)
   N=$(( ${LAST:-0} + 1 ))
   OUT="$OUTDIR/diagram-v$N.html"
   echo "$OUT"
   ```

3. **Build the file from the template.** Copy the template, then fill the three
   slots. Do NOT retype the overlay — it is the separate `overlay.js`:

   ```bash
   cp "$SKILL_DIR/template.html" "$OUT"
   ```

   Then use Edit on `$OUT`:
   - replace both `{{VERSION}}` with `vN` (replace_all),
   - replace `{{FILE}}` with `diagram-vN.html`,
   - replace the single line `<!-- SVG -->` with the full SVG markup.

   The `<script src="overlay.js">` in the template resolves next to the HTML, where
   step 2 copied `overlay.js`.

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

- Comment targets are only "a specific element" (`data-id`) or "the whole diagram".
  There is no edge/region/emoji taxonomy — keep it simple.
- The HTML references `./overlay.js`, so a diagram file is only valid alongside the
  `overlay.js` in the same folder (fine for the ephemeral temp dir). It is not a
  standalone single file.
- `overlay.js` is loaded as a classic script (not an ES module) on purpose: ES
  modules are blocked by CORS on `file://`, classic same-folder scripts are not.
- If the user has no `open` (non-macOS), give them the file path to open manually.
