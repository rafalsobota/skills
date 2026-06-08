# sedno — Faza 1: serwer MCP + widok w przeglądarce + pętla zwrotna (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zbudować lokalny serwer MCP (Bun) dla Claude Code, który renderuje SVG w oknie przeglądarki (livereload przez WebSocket), pozwala użytkownikowi dopisywać komentarze i wskazywać elementy, wersjonuje diagramy (id `v1`, `v2`, … + rodowód), a Claude pozyskuje feedback narzędziem `get_feedback` (model pull, „zobacz teraz").

**Architecture:** Dwa kanały komunikacji. (1) MCP po stdio między Claude Code a serwerem (`stdout` = wyłącznie JSON-RPC, logi na `stderr`). (2) Localhost WebSocket między serwerem a widokiem (push render/show do przeglądarki, odbiór flush/request-show z przeglądarki). Rdzeń logiki (`VersionStore`, `FeedbackBuffer`, `DiagramService`) jest czysty i jednostkowo testowalny; `ViewerBridge` (Bun.serve) i `buildMcpServer` to cienkie warstwy I/O. Widok w przeglądarce jest wymienialny — w Fazie 2 zostanie podmieniony na Electrobun za tym samym interfejsem.

**Tech Stack:** Bun 1.3.x (runtime + test runner), TypeScript, `@modelcontextprotocol/sdk@^1.29` (linia stabilna — NIE v2-alpha `@modelcontextprotocol/server`), `zod` (raw-shape inputSchema), vanilla HTML/CSS/JS w widoku (bez frameworka, bez build-stepu; SVG wstrzykiwany przez `DOMParser`, nie przez właściwość HTML — brak powierzchni XSS).

**Cel platformy:** macOS 14+.

**Spec:** `docs/superpowers/specs/2026-06-08-sedno-diagram-mcp-design.md`

---

## Struktura plików (Faza 1)

```
sedno.sh/
├── package.json                 # Task 1
├── tsconfig.json                # Task 1
├── .mcp.json                    # Task 10
├── src/
│   ├── types.ts                 # Task 2 — typy domenowe + interfejs BridgeLike + typy wiadomości WS
│   ├── version-store.ts         # Task 3 — historia wersji (id v1.., basedOn, wskaźnik current)
│   ├── feedback-buffer.ts       # Task 4 — bufor oczekujących komentarzy (push/peek/drain)
│   ├── viewer/
│   │   └── index.html           # Task 5 — widok w przeglądarce (SVG + komentarze + oś + Wyślij)
│   ├── viewer-bridge.ts         # Task 6 — Bun.serve: serwuje widok + WS broadcast/odbiór
│   ├── diagram-service.ts       # Task 7 — orkiestrator: render/showVersion/getFeedback + wiązanie bridge
│   ├── mcp-server.ts            # Task 8 — handlery narzędzi + zasobów + buildMcpServer
│   └── server.ts                # Task 9 — root kompozycyjny: stdio, lifecycle, lazy open browser
└── test/
    ├── fake-bridge.ts           # Task 7 — atrapa BridgeLike do testów
    ├── version-store.test.ts    # Task 3
    ├── feedback-buffer.test.ts  # Task 4
    ├── viewer-bridge.test.ts    # Task 6 — integracja WS na efemerycznym porcie
    ├── diagram-service.test.ts  # Task 7
    └── mcp-server.test.ts       # Task 8
```

**Kontrakt wiadomości WebSocket** (zdefiniowany w `src/types.ts`, używany przez bridge i widok):
- serwer → widok: `{type:"render", version, svg, history}` · `{type:"show", version, svg}` · `{type:"reload"}`
- widok → serwer: `{type:"hello"}` · `{type:"request-show", id}` · `{type:"flush", comments}`

**Zasada nadrzędna:** nigdy `console.log` (kontaminuje JSON-RPC na `stdout`). Wszystkie logi przez `console.error` (stderr).

---

## Task 1: Scaffold projektu (Bun + TypeScript)

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `test/smoke.test.ts` (tymczasowy — usuwany w Step 6)

- [ ] **Step 1: Utwórz `package.json`**

```json
{
  "name": "sedno",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "bun run src/server.ts",
    "test": "bun test",
    "typecheck": "bunx tsc --noEmit"
  }
}
```

- [ ] **Step 2: Zainstaluj zależności**

Run:
```bash
bun add @modelcontextprotocol/sdk@^1.29.0 zod@^3.23.8
bun add -d @types/bun typescript
```
Expected: `package.json` zyskuje `dependencies` i `devDependencies`; powstaje `bun.lockb`. Brak błędów instalacji.

- [ ] **Step 3: Utwórz `tsconfig.json`**

```json
{
  "compilerOptions": {
    "lib": ["ESNext", "DOM"],
    "module": "ESNext",
    "target": "ESNext",
    "moduleResolution": "bundler",
    "types": ["@types/bun"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 4: Utwórz tymczasowy test `test/smoke.test.ts`**

```ts
import { test, expect } from "bun:test";

test("bun test działa", () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 5: Uruchom test, by potwierdzić działanie runnera**

Run: `bun test ./test/smoke.test.ts`
Expected: `1 pass`, `0 fail`, `Ran 1 tests across 1 file.`

- [ ] **Step 6: Usuń tymczasowy test i zacommituj scaffold**

```bash
rm test/smoke.test.ts
git add package.json tsconfig.json bun.lockb
git commit -m "chore: scaffold Bun + TypeScript project"
```

---

## Task 2: Typy domenowe (`src/types.ts`)

**Files:**
- Create: `src/types.ts`

To plik wyłącznie z typami (brak testu jednostkowego); weryfikacja przez `tsc`.

- [ ] **Step 1: Utwórz `src/types.ts`**

```ts
// Wersja diagramu przechowywana w historii.
export interface Version {
  id: string;            // "v1", "v2", ...
  svg: string;
  title?: string;
  basedOn: string | null;
  createdAt: number;     // epoch ms
}

// Metadane wersji bez ciężkiego SVG (do osi historii i zasobu diagram://history).
export type VersionMeta = Omit<Version, "svg">;

// Cel komentarza: konkretny element, region (zbiór elementów) lub cały diagram.
export type CommentTarget =
  | { kind: "element"; id: string }
  | { kind: "region"; ids: string[] }
  | { kind: "global" };

// Pojedynczy komentarz użytkownika; versionId mówi, na której wersji powstał.
export interface Comment {
  versionId: string | null;
  target: CommentTarget;
  text: string;
}

// serwer -> widok
export type ViewerOutbound =
  | { type: "render"; version: VersionMeta; svg: string; history: VersionMeta[] }
  | { type: "show"; version: VersionMeta; svg: string }
  | { type: "reload" };

// widok -> serwer
export type ViewerInbound =
  | { type: "hello" }
  | { type: "request-show"; id: string }
  | { type: "flush"; comments: Comment[] };

// Minimalny interfejs mostu do widoku — pozwala wstrzyknąć atrapę w testach.
export interface BridgeLike {
  onFlush: (comments: Comment[]) => void;
  onRequestShow: (id: string) => void;
  onHello: () => void;
  broadcast(msg: ViewerOutbound): void;
}
```

- [ ] **Step 2: Sprawdź typy**

Run: `bun run typecheck`
Expected: brak błędów (kod kompiluje się czysto).

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: domain types (Version, Comment, viewer messages, BridgeLike)"
```

---

## Task 3: VersionStore (`src/version-store.ts`)

**Files:**
- Create: `src/version-store.ts`
- Test: `test/version-store.test.ts`

- [ ] **Step 1: Napisz test `test/version-store.test.ts`**

```ts
import { test, expect, describe, beforeEach } from "bun:test";
import { VersionStore } from "../src/version-store";

describe("VersionStore", () => {
  let store: VersionStore;
  beforeEach(() => { store = new VersionStore(); });

  test("nadaje sekwencyjne id v1, v2", () => {
    expect(store.add("<svg/>").id).toBe("v1");
    expect(store.add("<svg/>").id).toBe("v2");
  });

  test("get zwraca wersję; undefined dla brakującej", () => {
    const v = store.add("<svg id='a'/>", { title: "pierwsza" });
    expect(store.get("v1")).toEqual(v);
    expect(store.get("nope")).toBeUndefined();
  });

  test("current wskazuje ostatnio dodaną", () => {
    store.add("<svg/>");
    store.add("<svg/>");
    expect(store.current?.id).toBe("v2");
  });

  test("setCurrent zmienia wskaźnik; rzuca dla nieznanego id", () => {
    store.add("<svg/>");
    store.add("<svg/>");
    store.setCurrent("v1");
    expect(store.current?.id).toBe("v1");
    expect(() => store.setCurrent("v99")).toThrow("unknown version: v99");
  });

  test("history zwraca metadane (bez svg) w kolejności dodania", () => {
    store.add("<svg>A</svg>", { title: "A" });
    store.add("<svg>B</svg>", { basedOn: "v1" });
    const h = store.history();
    expect(h.map((v) => v.id)).toEqual(["v1", "v2"]);
    expect(h[1]).toEqual({ id: "v2", title: undefined, basedOn: "v1", createdAt: h[1]!.createdAt });
    expect((h[0] as any).svg).toBeUndefined();
  });

  test("lineage zwraca łańcuch root -> liść po basedOn", () => {
    store.add("<svg/>");
    store.add("<svg/>", { basedOn: "v1" });
    store.add("<svg/>", { basedOn: "v2" });
    expect(store.lineage("v3").map((v) => v.id)).toEqual(["v1", "v2", "v3"]);
  });
});
```

- [ ] **Step 2: Uruchom test — ma się nie skompilować/failować**

Run: `bun test ./test/version-store.test.ts`
Expected: FAIL — `Cannot find module "../src/version-store"` (plik jeszcze nie istnieje).

- [ ] **Step 3: Zaimplementuj `src/version-store.ts`**

```ts
import type { Version, VersionMeta } from "./types";

export class VersionStore {
  private versions = new Map<string, Version>();
  private order: string[] = [];
  private currentId: string | null = null;

  add(svg: string, opts: { title?: string; basedOn?: string | null } = {}): Version {
    const id = `v${this.order.length + 1}`;
    const version: Version = {
      id,
      svg,
      title: opts.title,
      basedOn: opts.basedOn ?? null,
      createdAt: Date.now(),
    };
    this.versions.set(id, version);
    this.order.push(id);
    this.currentId = id;
    return version;
  }

  get(id: string): Version | undefined {
    return this.versions.get(id);
  }

  get current(): Version | null {
    return this.currentId ? this.versions.get(this.currentId) ?? null : null;
  }

  setCurrent(id: string): void {
    if (!this.versions.has(id)) throw new Error(`unknown version: ${id}`);
    this.currentId = id;
  }

  history(): VersionMeta[] {
    return this.order.map((id) => {
      const { svg, ...meta } = this.versions.get(id)!;
      return meta;
    });
  }

  lineage(id: string): VersionMeta[] {
    const chain: VersionMeta[] = [];
    let cur = this.versions.get(id);
    while (cur) {
      const { svg, ...meta } = cur;
      chain.unshift(meta);
      cur = cur.basedOn ? this.versions.get(cur.basedOn) : undefined;
    }
    return chain;
  }
}
```

- [ ] **Step 4: Uruchom test — ma przejść**

Run: `bun test ./test/version-store.test.ts`
Expected: `6 pass`, `0 fail`.

- [ ] **Step 5: Commit**

```bash
git add src/version-store.ts test/version-store.test.ts
git commit -m "feat: VersionStore with sequential ids, lineage, current pointer"
```

---

## Task 4: FeedbackBuffer (`src/feedback-buffer.ts`)

**Files:**
- Create: `src/feedback-buffer.ts`
- Test: `test/feedback-buffer.test.ts`

- [ ] **Step 1: Napisz test `test/feedback-buffer.test.ts`**

```ts
import { test, expect, describe, beforeEach } from "bun:test";
import { FeedbackBuffer } from "../src/feedback-buffer";
import type { Comment } from "../src/types";

const c = (text: string): Comment => ({
  versionId: "v1",
  target: { kind: "global" },
  text,
});

describe("FeedbackBuffer", () => {
  let buf: FeedbackBuffer;
  beforeEach(() => { buf = new FeedbackBuffer(); });

  test("push + peek nie czyści", () => {
    buf.push(c("a")); buf.push(c("b"));
    expect(buf.peek().map((x) => x.text)).toEqual(["a", "b"]);
    expect(buf.peek().map((x) => x.text)).toEqual(["a", "b"]);
    expect(buf.size).toBe(2);
  });

  test("drain zwraca wszystko i czyści", () => {
    buf.push(c("a")); buf.push(c("b"));
    expect(buf.drain().map((x) => x.text)).toEqual(["a", "b"]);
    expect(buf.drain()).toEqual([]);
    expect(buf.peek()).toEqual([]);
    expect(buf.size).toBe(0);
  });
});
```

- [ ] **Step 2: Uruchom test — ma failować**

Run: `bun test ./test/feedback-buffer.test.ts`
Expected: FAIL — `Cannot find module "../src/feedback-buffer"`.

- [ ] **Step 3: Zaimplementuj `src/feedback-buffer.ts`**

```ts
import type { Comment } from "./types";

export class FeedbackBuffer {
  private items: Comment[] = [];

  push(comment: Comment): void {
    this.items.push(comment);
  }

  peek(): readonly Comment[] {
    return [...this.items];
  }

  drain(): Comment[] {
    const out = this.items;
    this.items = [];
    return out;
  }

  get size(): number {
    return this.items.length;
  }
}
```

- [ ] **Step 4: Uruchom test — ma przejść**

Run: `bun test ./test/feedback-buffer.test.ts`
Expected: `2 pass`, `0 fail`.

- [ ] **Step 5: Commit**

```bash
git add src/feedback-buffer.ts test/feedback-buffer.test.ts
git commit -m "feat: FeedbackBuffer (push/peek/drain)"
```

---

## Task 5: Widok w przeglądarce (`src/viewer/index.html`)

**Files:**
- Create: `src/viewer/index.html`

Statyczny zasób (HTML+CSS+JS, bez build-stepu). Serwowany przez `ViewerBridge` (Task 6). SVG wstrzykiwany przez `DOMParser` + `importNode` (bezpiecznie, bez właściwości HTML). Weryfikacja = obecność kluczowych markerów; pełna weryfikacja funkcjonalna w Task 6 (GET /) i Task 10 (e2e).

- [ ] **Step 1: Utwórz `src/viewer/index.html`**

```html
<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>sedno — diagram</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #0f1117; color: #cdd3e0; height: 100vh; display: grid;
    grid-template-columns: 1fr 240px; grid-template-rows: auto 1fr auto;
    grid-template-areas: "head head" "stage side" "foot foot";
  }
  header { grid-area: head; padding: 10px 16px; border-bottom: 1px solid #232838;
    display: flex; align-items: center; gap: 12px; }
  header h1 { font-size: 14px; margin: 0; font-weight: 700; color: #e6e9f0; }
  header .ver { font-size: 12px; color: #7f8aa3; }
  header .status { margin-left: auto; font-size: 11px; color: #f0a868; }
  header .status.ok { color: #34d3a6; }
  #stage { grid-area: stage; overflow: auto; padding: 20px; display: flex;
    align-items: center; justify-content: center; }
  #stage svg { max-width: 100%; height: auto; }
  #stage [data-node-id], #stage [data-edge-id] { cursor: pointer; }
  #stage [data-node-id]:hover, #stage [data-edge-id]:hover {
    outline: 2px solid #4c8dff; outline-offset: 2px; filter: drop-shadow(0 0 3px #4c8dff); }
  #stage [data-commented] { outline: 2px dashed #34d3a6 !important; outline-offset: 2px; }
  aside { grid-area: side; border-left: 1px solid #232838; padding: 12px; overflow: auto; }
  aside h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .05em;
    color: #7f8aa3; margin: 0 0 8px; }
  ul.timeline { list-style: none; margin: 0 0 16px; padding: 0; }
  ul.timeline li { padding: 6px 8px; border-radius: 6px; cursor: pointer; font-size: 13px;
    display: flex; gap: 6px; align-items: baseline; }
  ul.timeline li:hover { background: #1a1f2e; }
  ul.timeline li.current { background: #163a2e; color: #7fe9c8; }
  ul.timeline li .based { color: #7f8aa3; font-size: 11px; margin-left: auto; }
  footer { grid-area: foot; border-top: 1px solid #232838; padding: 10px 16px;
    display: flex; align-items: center; gap: 12px; }
  footer .queue { font-size: 12px; color: #7f8aa3; }
  button { font: inherit; cursor: pointer; border: 1px solid #2c3346; background: #1a1f2e;
    color: #cdd3e0; border-radius: 8px; padding: 8px 12px; }
  button.primary { background: #34d3a6; color: #06241b; border-color: #34d3a6; font-weight: 700; }
  button:disabled { opacity: .5; cursor: default; }
  #popover { position: fixed; z-index: 10; width: 280px; background: #161b27;
    border: 1px solid #2c3346; border-radius: 10px; padding: 12px; display: none;
    box-shadow: 0 8px 30px rgba(0,0,0,.5); }
  #popover.open { display: block; }
  #popover .tgt { font-size: 11px; color: #7f8aa3; margin-bottom: 6px; }
  #popover .chips { display: flex; gap: 6px; margin-bottom: 8px; }
  #popover .chips button { padding: 4px 8px; font-size: 14px; }
  #popover textarea { width: 100%; height: 64px; resize: vertical; background: #0f1117;
    color: #cdd3e0; border: 1px solid #2c3346; border-radius: 6px; padding: 6px; font: inherit; }
  #popover .row { display: flex; gap: 8px; margin-top: 8px; justify-content: flex-end; }
  .empty { color: #5b6580; font-size: 13px; }
</style>
</head>
<body>
  <header>
    <h1>sedno</h1>
    <span class="ver" id="curLabel">—</span>
    <span class="status" id="status">łączenie…</span>
  </header>
  <main id="stage"><div class="empty">Czekam na pierwszy diagram…</div></main>
  <aside>
    <h2>Historia wersji</h2>
    <ul class="timeline" id="timeline"></ul>
    <button id="globalBtn">💬 Komentarz ogólny</button>
  </aside>
  <footer>
    <span class="queue" id="queue">0 komentarzy w kolejce</span>
    <button class="primary" id="sendBtn" disabled>Wyślij do Claude →</button>
  </footer>

  <div id="popover">
    <div class="tgt" id="popTarget"></div>
    <div class="chips">
      <button data-emoji="🔍" title="pogłęb">🔍</button>
      <button data-emoji="✗" title="błędne">✗</button>
      <button data-emoji="✂️" title="uprość">✂️</button>
      <button data-emoji="?" title="pytanie">?</button>
    </div>
    <textarea id="popText" placeholder="Twój komentarz…"></textarea>
    <div class="row">
      <button id="popCancel">Anuluj</button>
      <button class="primary" id="popAdd">Dodaj</button>
    </div>
  </div>

<script>
(function () {
  "use strict";
  var WS_URL = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";
  var ws = null, reconnectTimer = null;
  var currentVersionId = null;
  var queue = [];          // Comment[]
  var activeTarget = null; // {kind:'element',id} | {kind:'global'}

  var stage = document.getElementById("stage");
  var timelineEl = document.getElementById("timeline");
  var statusEl = document.getElementById("status");
  var curLabel = document.getElementById("curLabel");
  var queueEl = document.getElementById("queue");
  var sendBtn = document.getElementById("sendBtn");
  var globalBtn = document.getElementById("globalBtn");
  var popover = document.getElementById("popover");
  var popTarget = document.getElementById("popTarget");
  var popText = document.getElementById("popText");

  function clearChildren(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function emptyMsg(text) {
    var d = document.createElement("div"); d.className = "empty"; d.textContent = text; return d;
  }

  function connect() {
    clearTimeout(reconnectTimer);
    try { ws = new WebSocket(WS_URL); } catch (e) { scheduleReconnect(); return; }
    ws.addEventListener("open", function () { setStatus("połączono", true); send({ type: "hello" }); });
    ws.addEventListener("message", function (ev) {
      var msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      handle(msg);
    });
    ws.addEventListener("close", function () { setStatus("rozłączono", false); scheduleReconnect(); });
    ws.addEventListener("error", function () { try { ws.close(); } catch (e) {} });
  }
  function scheduleReconnect() { clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, 1000); }
  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(obj)); return true; }
    return false;
  }
  function setStatus(t, ok) { statusEl.textContent = t; statusEl.className = "status" + (ok ? " ok" : ""); }

  function handle(msg) {
    if (msg.type === "render") {
      swapSvg(msg.svg);
      setCurrent(msg.version);
      renderTimeline(msg.history, msg.version.id);
    } else if (msg.type === "show") {
      swapSvg(msg.svg);
      setCurrent(msg.version);
      markCurrentInTimeline(msg.version.id);
    } else if (msg.type === "reload") {
      location.reload();
    }
  }
  function setCurrent(version) {
    currentVersionId = version.id;
    curLabel.textContent = version.id + (version.title ? " · " + version.title : "");
  }

  // Bezpieczne wstawienie SVG: parsujemy jako XML i importujemy węzeł (bez właściwości HTML).
  function swapSvg(svg) {
    clearChildren(stage);
    if (!svg) { stage.appendChild(emptyMsg("Pusty diagram.")); markCommented(); return; }
    var doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    var root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() === "parsererror") {
      stage.appendChild(emptyMsg("Błąd parsowania SVG.")); return;
    }
    stage.appendChild(document.importNode(root, true));
    markCommented();
  }

  function renderTimeline(history, currentId) {
    clearChildren(timelineEl);
    (history || []).forEach(function (v) {
      var li = document.createElement("li");
      li.dataset.id = v.id;
      if (v.id === currentId) li.className = "current";
      var label = document.createElement("span");
      label.textContent = v.id + (v.title ? " · " + v.title : "");
      li.appendChild(label);
      if (v.basedOn) {
        var b = document.createElement("span");
        b.className = "based"; b.textContent = "← " + v.basedOn;
        li.appendChild(b);
      }
      timelineEl.appendChild(li);
    });
  }
  function markCurrentInTimeline(id) {
    Array.prototype.forEach.call(timelineEl.children, function (li) {
      li.className = li.dataset.id === id ? "current" : "";
    });
  }

  timelineEl.addEventListener("click", function (ev) {
    var li = ev.target.closest("li");
    if (li && li.dataset.id) send({ type: "request-show", id: li.dataset.id });
  });

  stage.addEventListener("click", function (ev) {
    var el = ev.target.closest("[data-node-id],[data-edge-id]");
    if (!el) return;
    var id = el.getAttribute("data-node-id") || el.getAttribute("data-edge-id");
    openPopover({ kind: "element", id: id }, ev.clientX, ev.clientY);
  });
  globalBtn.addEventListener("click", function () {
    openPopover({ kind: "global" }, window.innerWidth - 320, 120);
  });

  function openPopover(target, x, y) {
    activeTarget = target;
    popTarget.textContent = target.kind === "global" ? "Komentarz ogólny" : "Element: " + target.id;
    popText.value = "";
    popover.style.left = Math.min(x, window.innerWidth - 300) + "px";
    popover.style.top = Math.min(y, window.innerHeight - 220) + "px";
    popover.classList.add("open");
    popText.focus();
  }
  function closePopover() { popover.classList.remove("open"); activeTarget = null; }

  Array.prototype.forEach.call(popover.querySelectorAll(".chips button"), function (b) {
    b.addEventListener("click", function () {
      popText.value = (b.dataset.emoji + " " + popText.value).replace(/^\s+/, "");
      popText.focus();
    });
  });
  document.getElementById("popCancel").addEventListener("click", closePopover);
  document.getElementById("popAdd").addEventListener("click", function () {
    var text = popText.value.trim();
    if (!text || !activeTarget) { closePopover(); return; }
    queue.push({ versionId: currentVersionId, target: activeTarget, text: text });
    updateQueue();
    closePopover();
    markCommented();
  });

  function updateQueue() {
    queueEl.textContent = queue.length + (queue.length === 1 ? " komentarz" : " komentarzy") + " w kolejce";
    sendBtn.disabled = queue.length === 0;
  }
  function markCommented() {
    var ids = {};
    queue.forEach(function (cm) {
      if (cm.versionId === currentVersionId && cm.target.kind === "element") ids[cm.target.id] = true;
    });
    Array.prototype.forEach.call(stage.querySelectorAll("[data-node-id],[data-edge-id]"), function (el) {
      var id = el.getAttribute("data-node-id") || el.getAttribute("data-edge-id");
      if (ids[id]) el.setAttribute("data-commented", "1"); else el.removeAttribute("data-commented");
    });
  }

  sendBtn.addEventListener("click", function () {
    if (queue.length === 0) return;
    if (send({ type: "flush", comments: queue.slice() })) {
      queue = [];
      updateQueue();
      markCommented();
    }
  });

  connect();
})();
</script>
</body>
</html>
```

- [ ] **Step 2: Zweryfikuj obecność kluczowych markerów**

Run:
```bash
grep -q 'id="stage"' src/viewer/index.html \
  && grep -q '"request-show"' src/viewer/index.html \
  && grep -q '"flush"' src/viewer/index.html \
  && grep -q 'Wyślij do Claude' src/viewer/index.html \
  && grep -q 'DOMParser' src/viewer/index.html \
  && echo "viewer markers OK"
```
Expected: `viewer markers OK`.

- [ ] **Step 3: Commit**

```bash
git add src/viewer/index.html
git commit -m "feat: browser viewer (svg stage via DOMParser, comments, timeline, send)"
```

---

## Task 6: ViewerBridge (`src/viewer-bridge.ts`)

**Files:**
- Create: `src/viewer-bridge.ts`
- Test: `test/viewer-bridge.test.ts`

- [ ] **Step 1: Napisz test `test/viewer-bridge.test.ts`**

```ts
import { test, expect, describe, afterEach } from "bun:test";
import { ViewerBridge } from "../src/viewer-bridge";
import type { Comment } from "../src/types";

// Czeka na następną wiadomość WS lub failuje szybko.
function nextMessage(ws: WebSocket, timeoutMs = 1000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error("timeout")); }, timeoutMs);
    function onMessage(ev: MessageEvent) { cleanup(); resolve(String(ev.data)); }
    function onError() { cleanup(); reject(new Error("socket error")); }
    function cleanup() {
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      ws.removeEventListener("error", onError);
    }
    ws.addEventListener("message", onMessage);
    ws.addEventListener("error", onError);
  });
}
function waitOpen(ws: WebSocket, timeoutMs = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("open timeout")), timeoutMs);
    ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("open error")); }, { once: true });
  });
}

describe("ViewerBridge", () => {
  let bridge: ViewerBridge | undefined;
  let client: WebSocket | undefined;

  afterEach(() => {
    if (client && client.readyState <= WebSocket.OPEN) client.close();
    client = undefined;
    bridge?.stop();
    bridge = undefined;
  });

  test("serwuje widok HTML pod /", async () => {
    bridge = new ViewerBridge();
    await bridge.start();
    const res = await fetch(bridge.url);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="stage"');
  });

  test("broadcast dociera do podłączonego widoku", async () => {
    bridge = new ViewerBridge();
    await bridge.start();
    const wsUrl = bridge.url.replace(/^http/, "ws") + "ws";
    client = new WebSocket(wsUrl);
    await waitOpen(client);
    bridge.broadcast({ type: "reload" });
    const raw = await nextMessage(client);
    expect(JSON.parse(raw)).toEqual({ type: "reload" });
  });

  test("flush z widoku trafia do onFlush", async () => {
    bridge = new ViewerBridge();
    const got = new Promise<Comment[]>((resolve) => { bridge!.onFlush = resolve; });
    await bridge.start();
    const wsUrl = bridge.url.replace(/^http/, "ws") + "ws";
    client = new WebSocket(wsUrl);
    await waitOpen(client);
    const comments: Comment[] = [{ versionId: "v1", target: { kind: "global" }, text: "ok" }];
    client.send(JSON.stringify({ type: "flush", comments }));
    expect(await got).toEqual(comments);
  });

  test("request-show z widoku trafia do onRequestShow", async () => {
    bridge = new ViewerBridge();
    const got = new Promise<string>((resolve) => { bridge!.onRequestShow = resolve; });
    await bridge.start();
    const wsUrl = bridge.url.replace(/^http/, "ws") + "ws";
    client = new WebSocket(wsUrl);
    await waitOpen(client);
    client.send(JSON.stringify({ type: "request-show", id: "v3" }));
    expect(await got).toBe("v3");
  });
});
```

- [ ] **Step 2: Uruchom test — ma failować**

Run: `bun test ./test/viewer-bridge.test.ts`
Expected: FAIL — `Cannot find module "../src/viewer-bridge"`.

- [ ] **Step 3: Zaimplementuj `src/viewer-bridge.ts`**

```ts
import type { Server } from "bun";
import { join } from "path";
import type { BridgeLike, Comment, ViewerInbound, ViewerOutbound } from "./types";

const VIEWER_HTML_PATH = join(import.meta.dir, "viewer", "index.html");
const TOPIC = "viewers";

export class ViewerBridge implements BridgeLike {
  private server: Server | null = null;
  private html = "";

  onFlush: (comments: Comment[]) => void = () => {};
  onRequestShow: (id: string) => void = () => {};
  onHello: () => void = () => {};

  async start(): Promise<void> {
    this.html = await Bun.file(VIEWER_HTML_PATH).text();
    const self = this;
    this.server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, server) {
        const url = new URL(req.url);
        if (url.pathname === "/ws") {
          if (server.upgrade(req)) return undefined; // po sukcesie MUSI zwrócić undefined
          return new Response("upgrade failed", { status: 400 });
        }
        return new Response(self.html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      },
      websocket: {
        open(ws) { ws.subscribe(TOPIC); },
        message(ws, raw) {
          let msg: ViewerInbound;
          try { msg = JSON.parse(String(raw)) as ViewerInbound; } catch { return; }
          if (msg.type === "flush") self.onFlush(msg.comments);
          else if (msg.type === "request-show") self.onRequestShow(msg.id);
          else if (msg.type === "hello") self.onHello();
        },
        close(ws) { ws.unsubscribe(TOPIC); },
      },
    });
  }

  get url(): string {
    if (!this.server) throw new Error("bridge not started");
    return this.server.url.href;
  }

  broadcast(msg: ViewerOutbound): void {
    this.server?.publish(TOPIC, JSON.stringify(msg));
  }

  stop(): void {
    this.server?.stop(true); // wymuś zamknięcie aktywnych połączeń (inaczej runner może zawisnąć)
    this.server = null;
  }
}
```

- [ ] **Step 4: Uruchom test — ma przejść**

Run: `bun test ./test/viewer-bridge.test.ts`
Expected: `4 pass`, `0 fail`.

- [ ] **Step 5: Commit**

```bash
git add src/viewer-bridge.ts test/viewer-bridge.test.ts
git commit -m "feat: ViewerBridge (Bun.serve http + websocket broadcast/receive)"
```

---

## Task 7: DiagramService (`src/diagram-service.ts`)

**Files:**
- Create: `src/diagram-service.ts`
- Create: `test/fake-bridge.ts`
- Test: `test/diagram-service.test.ts`

- [ ] **Step 1: Napisz atrapę `test/fake-bridge.ts`**

```ts
import type { BridgeLike, Comment, ViewerOutbound } from "../src/types";

export class FakeBridge implements BridgeLike {
  onFlush: (comments: Comment[]) => void = () => {};
  onRequestShow: (id: string) => void = () => {};
  onHello: () => void = () => {};
  sent: ViewerOutbound[] = [];

  broadcast(msg: ViewerOutbound): void {
    this.sent.push(msg);
  }
}
```

- [ ] **Step 2: Napisz test `test/diagram-service.test.ts`**

```ts
import { test, expect, describe, beforeEach } from "bun:test";
import { VersionStore } from "../src/version-store";
import { FeedbackBuffer } from "../src/feedback-buffer";
import { DiagramService } from "../src/diagram-service";
import { FakeBridge } from "./fake-bridge";

function setup(opts?: { onFirstRender?: () => void }) {
  const store = new VersionStore();
  const buffer = new FeedbackBuffer();
  const bridge = new FakeBridge();
  const service = new DiagramService(store, buffer, bridge, opts);
  return { store, buffer, bridge, service };
}

describe("DiagramService", () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => { s = setup(); });

  test("render dodaje wersję i nadaje render z historią", () => {
    const v = s.service.render({ svg: "<svg>A</svg>", title: "A" });
    expect(v.id).toBe("v1");
    expect(s.store.current?.svg).toBe("<svg>A</svg>");
    const msg = s.bridge.sent.at(-1)!;
    expect(msg.type).toBe("render");
    if (msg.type === "render") {
      expect(msg.version.id).toBe("v1");
      expect(msg.svg).toBe("<svg>A</svg>");
      expect(msg.history.map((h) => h.id)).toEqual(["v1"]);
    }
  });

  test("onFirstRender wywoływane tylko raz", () => {
    let calls = 0;
    const s2 = setup({ onFirstRender: () => { calls++; } });
    s2.service.render({ svg: "<svg/>" });
    s2.service.render({ svg: "<svg/>" });
    expect(calls).toBe(1);
  });

  test("showVersion ustawia current i nadaje show", () => {
    s.service.render({ svg: "<svg>A</svg>" });
    s.service.render({ svg: "<svg>B</svg>" });
    const v = s.service.showVersion("v1");
    expect(v.id).toBe("v1");
    expect(s.store.current?.id).toBe("v1");
    const msg = s.bridge.sent.at(-1)!;
    expect(msg.type).toBe("show");
    if (msg.type === "show") expect(msg.svg).toBe("<svg>A</svg>");
  });

  test("showVersion rzuca dla nieznanego id", () => {
    expect(() => s.service.showVersion("v9")).toThrow("unknown version: v9");
  });

  test("bridge.onFlush wpisuje komentarze do bufora; getFeedback drenuje", () => {
    s.service.render({ svg: "<svg/>" });
    s.bridge.onFlush([{ versionId: "v1", target: { kind: "global" }, text: "uwaga" }]);
    expect(s.service.peekFeedback().map((c) => c.text)).toEqual(["uwaga"]);
    expect(s.service.getFeedback().map((c) => c.text)).toEqual(["uwaga"]);
    expect(s.service.getFeedback()).toEqual([]);
  });

  test("bridge.onRequestShow przełącza wersję (i ignoruje nieznane id)", () => {
    s.service.render({ svg: "<svg>A</svg>" });
    s.service.render({ svg: "<svg>B</svg>" });
    s.bridge.onRequestShow("v1");
    expect(s.store.current?.id).toBe("v1");
    s.bridge.onRequestShow("v999"); // nie rzuca
    expect(s.store.current?.id).toBe("v1");
  });

  test("bridge.onHello ponownie nadaje bieżącą wersję", () => {
    s.service.render({ svg: "<svg>A</svg>" });
    s.bridge.sent.length = 0;
    s.bridge.onHello();
    const msg = s.bridge.sent.at(-1)!;
    expect(msg.type).toBe("render");
    if (msg.type === "render") expect(msg.version.id).toBe("v1");
  });
});
```

- [ ] **Step 3: Uruchom test — ma failować**

Run: `bun test ./test/diagram-service.test.ts`
Expected: FAIL — `Cannot find module "../src/diagram-service"`.

- [ ] **Step 4: Zaimplementuj `src/diagram-service.ts`**

```ts
import type { VersionStore } from "./version-store";
import type { FeedbackBuffer } from "./feedback-buffer";
import type { BridgeLike, Comment, Version, VersionMeta } from "./types";

function meta(v: Version): VersionMeta {
  const { svg, ...m } = v;
  return m;
}

export interface DiagramServiceOptions {
  onFirstRender?: () => void;
}

export class DiagramService {
  private opened = false;

  constructor(
    private store: VersionStore,
    private buffer: FeedbackBuffer,
    private bridge: BridgeLike,
    private opts: DiagramServiceOptions = {},
  ) {
    bridge.onFlush = (comments) => {
      for (const c of comments) this.buffer.push(c);
    };
    bridge.onRequestShow = (id) => {
      try { this.showVersion(id); } catch { /* nieznane id ze starego widoku — ignoruj */ }
    };
    bridge.onHello = () => this.broadcastCurrent();
  }

  render(input: { svg: string; title?: string; basedOn?: string | null }): Version {
    if (!this.opened) {
      this.opened = true;
      this.opts.onFirstRender?.();
    }
    const v = this.store.add(input.svg, { title: input.title, basedOn: input.basedOn });
    this.bridge.broadcast({
      type: "render",
      version: meta(v),
      svg: v.svg,
      history: this.store.history(),
    });
    return v;
  }

  showVersion(id: string): Version {
    this.store.setCurrent(id);
    const v = this.store.get(id)!;
    this.bridge.broadcast({ type: "show", version: meta(v), svg: v.svg });
    return v;
  }

  getFeedback(): Comment[] {
    return this.buffer.drain();
  }

  peekFeedback(): readonly Comment[] {
    return this.buffer.peek();
  }

  currentVersion(): Version | null {
    return this.store.current;
  }

  getVersion(id: string): Version | undefined {
    return this.store.get(id);
  }

  history(): VersionMeta[] {
    return this.store.history();
  }

  private broadcastCurrent(): void {
    const v = this.store.current;
    if (!v) return;
    this.bridge.broadcast({
      type: "render",
      version: meta(v),
      svg: v.svg,
      history: this.store.history(),
    });
  }
}
```

- [ ] **Step 5: Uruchom test — ma przejść**

Run: `bun test ./test/diagram-service.test.ts`
Expected: `7 pass`, `0 fail`.

- [ ] **Step 6: Commit**

```bash
git add src/diagram-service.ts test/fake-bridge.ts test/diagram-service.test.ts
git commit -m "feat: DiagramService orchestrator (render/showVersion/getFeedback + bridge wiring)"
```

---

## Task 8: Serwer MCP — narzędzia i zasoby (`src/mcp-server.ts`)

**Files:**
- Create: `src/mcp-server.ts`
- Test: `test/mcp-server.test.ts`

- [ ] **Step 1: Napisz test `test/mcp-server.test.ts`**

```ts
import { test, expect, describe, beforeEach } from "bun:test";
import { VersionStore } from "../src/version-store";
import { FeedbackBuffer } from "../src/feedback-buffer";
import { DiagramService } from "../src/diagram-service";
import { FakeBridge } from "./fake-bridge";
import {
  handleRenderDiagram,
  handleShowVersion,
  handleGetFeedback,
  buildMcpServer,
} from "../src/mcp-server";

function service() {
  const bridge = new FakeBridge();
  const svc = new DiagramService(new VersionStore(), new FeedbackBuffer(), bridge);
  return { svc, bridge };
}

describe("MCP handlers", () => {
  let s: ReturnType<typeof service>;
  beforeEach(() => { s = service(); });

  test("handleRenderDiagram renderuje i zwraca id w tekście", () => {
    const out = handleRenderDiagram(s.svc, { svg: "<svg>A</svg>", title: "A" });
    expect(out.content[0]!.text).toContain("v1");
    expect(s.svc.currentVersion()?.svg).toBe("<svg>A</svg>");
  });

  test("handleShowVersion dla nieznanego id zwraca isError", () => {
    const out = handleShowVersion(s.svc, { id: "v9" });
    expect(out.isError).toBe(true);
    expect(out.content[0]!.text).toContain("v9");
  });

  test("handleShowVersion przełącza istniejącą wersję", () => {
    s.svc.render({ svg: "<svg>A</svg>" });
    s.svc.render({ svg: "<svg>B</svg>" });
    const out = handleShowVersion(s.svc, { id: "v1" });
    expect(out.isError).toBeUndefined();
    expect(s.svc.currentVersion()?.id).toBe("v1");
  });

  test("handleGetFeedback: pusto, potem JSON komentarzy, potem znów pusto", () => {
    expect(handleGetFeedback(s.svc).content[0]!.text).toBe("No pending feedback.");
    s.svc.render({ svg: "<svg/>" });
    s.bridge.onFlush([{ versionId: "v1", target: { kind: "global" }, text: "uwaga" }]);
    expect(handleGetFeedback(s.svc).content[0]!.text).toContain("uwaga");
    expect(handleGetFeedback(s.svc).content[0]!.text).toBe("No pending feedback.");
  });

  test("buildMcpServer konstruuje się bez wyjątku", () => {
    const server = buildMcpServer(s.svc);
    expect(server).toBeTruthy();
  });
});
```

- [ ] **Step 2: Uruchom test — ma failować**

Run: `bun test ./test/mcp-server.test.ts`
Expected: FAIL — `Cannot find module "../src/mcp-server"`.

- [ ] **Step 3: Zaimplementuj `src/mcp-server.ts`**

```ts
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DiagramService } from "./diagram-service";

const RENDER_DESCRIPTION =
  "Render an SVG diagram into the user's live window as a new version. " +
  "Put a STABLE `data-node-id` attribute on each node element and a STABLE " +
  "`data-edge-id` on each edge/connector so the user can click them to comment. " +
  "Returns the new version id (v1, v2, ...). Non-blocking: the diagram appears " +
  "immediately and you keep talking. To collect the user's comments, call " +
  "get_feedback (e.g. after the user says 'zobacz teraz'). To build on an earlier " +
  "version, pass its id as basedOn.";

type TextResult = {
  content: { type: "text"; text: string }[];
  isError?: true;
};

// --- czyste handlery (testowalne bez transportu) ---

export function handleRenderDiagram(
  service: DiagramService,
  args: { svg: string; title?: string; basedOn?: string },
): TextResult {
  const v = service.render({ svg: args.svg, title: args.title, basedOn: args.basedOn });
  return { content: [{ type: "text", text: `Rendered ${v.id}${v.title ? ` (${v.title})` : ""}.` }] };
}

export function handleShowVersion(service: DiagramService, args: { id: string }): TextResult {
  try {
    const v = service.showVersion(args.id);
    return { content: [{ type: "text", text: `Showing ${v.id}.` }] };
  } catch {
    return { content: [{ type: "text", text: `Unknown version: ${args.id}.` }], isError: true };
  }
}

export function handleGetFeedback(service: DiagramService): TextResult {
  const comments = service.getFeedback();
  if (comments.length === 0) {
    return { content: [{ type: "text", text: "No pending feedback." }] };
  }
  return { content: [{ type: "text", text: JSON.stringify(comments, null, 2) }] };
}

// --- rejestracja w McpServer (cienkie wiązanie + powiadomienia o zasobach) ---

export function buildMcpServer(service: DiagramService): McpServer {
  const server = new McpServer(
    { name: "sedno", version: "0.1.0" },
    {
      capabilities: {
        tools: { listChanged: true },
        resources: { subscribe: true, listChanged: true },
      },
    },
  );

  server.registerTool(
    "render_diagram",
    {
      title: "Render diagram",
      description: RENDER_DESCRIPTION,
      inputSchema: {
        svg: z.string().describe("Complete <svg>...</svg> markup."),
        title: z.string().optional().describe("Short label for this version."),
        basedOn: z.string().optional().describe("Version id this builds on, e.g. 'v3'."),
      },
    },
    async (args) => {
      const out = handleRenderDiagram(service, args);
      server.sendResourceListChanged();
      await server.server.sendResourceUpdated({ uri: "diagram://current" });
      return out;
    },
  );

  server.registerTool(
    "show_version",
    {
      title: "Show version",
      description:
        "Switch the window to display an existing diagram version by id (e.g. 'v3') without regenerating it.",
      inputSchema: { id: z.string().describe("Version id, e.g. 'v3'.") },
    },
    async (args) => {
      const out = handleShowVersion(service, args);
      if (!out.isError) await server.server.sendResourceUpdated({ uri: "diagram://current" });
      return out;
    },
  );

  server.registerTool(
    "get_feedback",
    {
      title: "Get feedback",
      description:
        "Return and clear the user's pending diagram comments (call after the user signals they are ready, e.g. 'zobacz teraz').",
      inputSchema: {},
    },
    async () => {
      const out = handleGetFeedback(service);
      await server.server.sendResourceUpdated({ uri: "diagram://pending" });
      return out;
    },
  );

  server.registerResource(
    "current",
    "diagram://current",
    { title: "Current diagram", mimeType: "image/svg+xml" },
    async (uri) => {
      const v = service.currentVersion();
      return { contents: [{ uri: uri.href, mimeType: "image/svg+xml", text: v?.svg ?? "" }] };
    },
  );

  server.registerResource(
    "history",
    "diagram://history",
    { title: "Version history", mimeType: "application/json" },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(service.history(), null, 2) }],
    }),
  );

  server.registerResource(
    "pending",
    "diagram://pending",
    { title: "Pending feedback", mimeType: "application/json" },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(service.peekFeedback(), null, 2) }],
    }),
  );

  server.registerResource(
    "version",
    new ResourceTemplate("diagram://version/{id}", { list: undefined }),
    { title: "Diagram version", mimeType: "image/svg+xml" },
    async (uri, { id }) => {
      const v = service.getVersion(String(id));
      return { contents: [{ uri: uri.href, mimeType: "image/svg+xml", text: v?.svg ?? "" }] };
    },
  );

  return server;
}
```

- [ ] **Step 4: Uruchom test — ma przejść**

Run: `bun test ./test/mcp-server.test.ts`
Expected: `5 pass`, `0 fail`.

- [ ] **Step 5: Uruchom CAŁY zestaw testów (regresja)**

Run: `bun test`
Expected: wszystkie pliki zielone (`version-store`, `feedback-buffer`, `viewer-bridge`, `diagram-service`, `mcp-server`), `0 fail`.

- [ ] **Step 6: Commit**

```bash
git add src/mcp-server.ts test/mcp-server.test.ts
git commit -m "feat: MCP tools (render_diagram, show_version, get_feedback) + resources"
```

---

## Task 9: Root kompozycyjny (`src/server.ts`)

**Files:**
- Create: `src/server.ts`

Punkt wejścia: spina komponenty, podłącza stdio, lazy-otwiera przeglądarkę przy pierwszym renderze, sprząta przy zamknięciu. Weryfikacja = smoke MCP `initialize` po stdio (brak testu jednostkowego dla roota procesu).

- [ ] **Step 1: Zaimplementuj `src/server.ts`**

```ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { VersionStore } from "./version-store";
import { FeedbackBuffer } from "./feedback-buffer";
import { ViewerBridge } from "./viewer-bridge";
import { DiagramService } from "./diagram-service";
import { buildMcpServer } from "./mcp-server";

// WAŻNE: logi WYŁĄCZNIE na stderr — stdout należy do JSON-RPC.
const log = (...a: unknown[]) => console.error("[sedno]", ...a);

async function main() {
  const store = new VersionStore();
  const buffer = new FeedbackBuffer();
  const bridge = new ViewerBridge();
  await bridge.start();
  log("viewer serving at", bridge.url);

  const service = new DiagramService(store, buffer, bridge, {
    onFirstRender: () => {
      log("opening viewer:", bridge.url);
      Bun.spawn(["open", bridge.url], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    },
  });

  const server = buildMcpServer(service);

  let shuttingDown = false;
  const shutdown = (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("shutting down:", sig);
    bridge.stop();
    process.exit(0);
  };

  const transport = new StdioServerTransport();
  transport.onclose = () => shutdown("stdin-closed"); // Claude Code zamknął nasze stdin
  await server.connect(transport);
  log("MCP server connected over stdio");

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((e) => {
  console.error("[sedno] fatal:", e);
  process.exit(1);
});
```

- [ ] **Step 2: Smoke — handshake MCP po stdio**

Run:
```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  | bun run src/server.ts 2>/tmp/sedno-smoke.err | head -1
echo "--- stderr ---"; cat /tmp/sedno-smoke.err
```
Expected:
- stdout (pierwsza linia): JSON zawierający `"result"` oraz `"serverInfo":{"name":"sedno"...}`.
- stderr (`/tmp/sedno-smoke.err`): linie `[sedno] viewer serving at http://127.0.0.1:...` oraz `[sedno] MCP server connected over stdio`.
- Przeglądarka NIE otwiera się (onFirstRender odpala dopiero przy `render_diagram`, nie przy `initialize`).

- [ ] **Step 3: Typecheck całości**

Run: `bun run typecheck`
Expected: brak błędów.

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat: composition root (stdio transport, lifecycle, lazy browser open)"
```

---

## Task 10: Rejestracja w Claude Code + akceptacja end-to-end

**Files:**
- Create: `.mcp.json`

- [ ] **Step 1: Utwórz `.mcp.json`**

```json
{
  "mcpServers": {
    "sedno": {
      "command": "bun",
      "args": ["run", "/Users/rafalsobota/Developer/sedno.sh/src/server.ts"]
    }
  }
}
```

- [ ] **Step 2: Commit konfiguracji**

```bash
git add .mcp.json
git commit -m "chore: register sedno MCP server (.mcp.json)"
```

- [ ] **Step 3: Załaduj serwer w Claude Code**

W nowej sesji Claude Code w katalogu `/Users/rafalsobota/Developer/sedno.sh` zatwierdź ładowanie serwera `sedno` z `.mcp.json` (lub uruchom `claude mcp list`, by potwierdzić, że `sedno` jest połączony). Sprawdź, że narzędzia `render_diagram`, `show_version`, `get_feedback` są widoczne.

- [ ] **Step 4: Akceptacja pętli (ręczna)**

Wykonaj w sesji Claude Code i potwierdź każdy punkt:
1. Poproś Claude o `render_diagram` z prostym SVG zawierającym dwa węzły z `data-node-id` (np. `node-a`, `node-b`) i krawędź z `data-edge-id="edge-1"`.
   - Oczekiwane: otwiera się karta przeglądarki z diagramem; w panelu „Historia wersji" jest `v1`; nagłówek pokazuje `v1`.
2. Najedź na węzeł → podświetlenie; kliknij węzeł → popover; wpisz komentarz, użyj emoji 🔍; „Dodaj".
   - Oczekiwane: licznik „1 komentarz w kolejce"; węzeł ma zieloną przerywaną obwódkę; „Wyślij do Claude" aktywny.
3. Kliknij „Wyślij do Claude".
   - Oczekiwane: kolejka wraca do 0.
4. W sesji napisz „zobacz teraz"; Claude woła `get_feedback`.
   - Oczekiwane: Claude otrzymuje komentarz (z `versionId:"v1"`, `target.id:"node-a"`, tekstem z 🔍) i może przebudować diagram, wołając `render_diagram` z `basedOn:"v1"` → pojawia się `v2`.
5. Kliknij `v1` na osi historii.
   - Oczekiwane: okno wraca do diagramu `v1` (wiadomość `show`); nagłówek `v1`.
6. Zamknij sesję Claude Code.
   - Oczekiwane: proces serwera kończy się (brak osieroconego procesu — sprawdź `pgrep -f 'src/server.ts'` → brak wyniku).

- [ ] **Step 5: Commit (jeśli były poprawki) i domknięcie Fazy 1**

```bash
git add -A
git commit -m "test: end-to-end acceptance of Phase 1 loop" || echo "brak zmian do commita"
```

---

## Self-Review (wykonany przy pisaniu planu)

**1. Pokrycie specu:**
- §1–2 model i UX → Tasks 5 (widok), 7 (service), 10 (akceptacja).
- §3 architektura dwuprocesowa → Tasks 6 (bridge/WS), 8 (MCP/stdio), 9 (root). (Faza 1 = widok przeglądarkowy zamiast Electrobun, zgodnie z §10 strategii etapowej specu.)
- §4 feedback pull baseline (`get_feedback` + „zobacz teraz") → Tasks 7, 8, 10. (Channel = Faza 3, świadomie poza tym planem.)
- §5 kontrakt narzędzi/zasobów → Task 8 (wszystkie narzędzia i zasoby, w tym `diagram://version/{id}`).
- §6 kontrakt tożsamości elementów (`data-node-id`/`data-edge-id`, `versionId` w komentarzu) → Task 5 (klikalność + serializacja), opis narzędzia w Task 8.
- §7 cykl życia/higiena (stderr-only, sprzątanie, lazy open) → Task 9. (Fokus `.accessory` dotyczy Electrobun → Faza 2.)
- Wersjonowanie (lista + rodowód, `show_version`, `basedOn`) → Tasks 3, 7, 8, 10.

**2. Skan placeholderów:** brak „TBD/TODO"; każdy krok zawiera pełny kod lub konkretną komendę z oczekiwanym wynikiem.

**3. Spójność typów:** `VersionStore.add(svg, {title,basedOn})`, `DiagramService.render({svg,title,basedOn})`, `BridgeLike` (onFlush/onRequestShow/onHello/broadcast) i typy wiadomości `ViewerOutbound/ViewerInbound` użyte jednolicie w bridge, service, widoku i testach. Handlery MCP (`handleRenderDiagram/handleShowVersion/handleGetFeedback`) i `buildMcpServer` zgodne między implementacją (Task 8) a testem (Task 8 Step 1).

**Świadomie poza Fazą 1 (osobne plany):** Faza 2 — podmiana widoku na Electrobun za interfejsem `BridgeLike`/WS; Faza 3 — warstwa channel (`notifications/claude/channel` jako sygnał obudzenia).
