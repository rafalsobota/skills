# skills

A collection of [agent skills](https://code.claude.com/docs/en/skills) for Claude Code
and other compatible coding agents (Cursor, OpenCode, …).

Each skill is a self-contained `SKILL.md` (plus its assets) under [`skills/`](skills/).

## Install

Using the [skills.sh](https://skills.sh) CLI ([`vercel-labs/skills`](https://github.com/vercel-labs/skills)):

```bash
# install everything in this repo
npx skills add rafalsobota/skills

# or a single skill
npx skills add rafalsobota/skills/skills/diagram-review
```

This drops the skill into your agent's skills directory (e.g. `.claude/skills/`).
You can also just copy a skill folder into your own `.claude/skills/` manually.

## Skills

| Skill | What it does |
| --- | --- |
| [`diagram-review`](skills/diagram-review/) | Render a diagram (architecture, flow, state machine, data model) as an HTML canvas with Figma-style click-to-comment pins, open it in the browser, and feed the user's pasted feedback back into the conversation to iterate. No server — the return path is a copied Markdown block. |

## Usage

Once installed, the skill activates automatically when its description matches what
you're doing — e.g. asking Claude to "draw and let me review an architecture diagram"
triggers `diagram-review`. You can also invoke a skill explicitly by name.

## Contributing

Each skill lives in `skills/<name>/` with a `SKILL.md` whose YAML frontmatter has a
`name` and a `description`. The `description` is what an agent matches against to decide
when to load the skill, so make it concrete about *when* to use it.

## License

[MIT](LICENSE) © Rafał Sobota
