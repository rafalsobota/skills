# Phase 2 — Native Electrobun Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase 1 browser viewer with a native macOS Electrobun window, behind the exact same `BridgeLike` interface, talking to the pure-Bun MCP server over a **Unix domain socket** (no TCP port, no token).

**Architecture:** Two processes. The MCP server stays pure Bun and owns stdin/stdout JSON-RPC (front door frozen — `.mcp.json` unchanged). On first render it lazily exec's the built Electrobun app's internal binary (`.app/Contents/MacOS/launcher`) with its **own stdio** (never our stdout) and the socket path passed via the `SEDNO_SOCK` **env var**. The window process connects to the server's Unix-socket listener, relays diagram content to its webview over Electroview **RPC**, and self-quits (`Utils.quit()`) when the socket drops (watchdog). The server also actively kills the child on stdin EOF / SIGTERM. Two independent cleanup paths ⇒ no orphan window survives the server.

**Tech Stack:** Bun 1.3.x (local 1.3.11 verified — no bump needed), `@modelcontextprotocol/sdk@^1.29` (stdio transport — unchanged), `electrobun@1.18.4-beta.5` (`electrobun/bun`, `electrobun/view`; **dev** build target — flat & directly spawnable), Bun Unix sockets (`Bun.listen`/`Bun.connect`), newline-delimited JSON framing.

---

## Decisions locked during design (do not re-litigate)

- **Front door = MCP-stdio.** Claude Code spawns the server; stdin EOF / SIGTERM = shutdown. `.mcp.json` unchanged.
- **Server↔window transport = Unix domain socket, NO token.** Filesystem permissions (per-session `0700` temp dir) are the access boundary. The Phase 1 WS token gap dissolves because there is no listening TCP port.
- **`SEDNO_SOCK` passed via env, NOT argv.** VERIFIED empirically: the Zig launcher forwards the parent env (`getEnvMap`) to the inner bun — a child spawned with `env: { SEDNO_SOCK }` reads it via `Bun.env.SEDNO_SOCK`. The launcher hardcodes the inner-bun argv and discards its own, so argv is NOT an option.
- **Bun IPC (`Bun.spawn({ipc})`) ruled OUT.** The Zig launcher is the direct child and does not relay the IPC fd / `NODE_CHANNEL_FD` to the inner bun grandchild.
- **Child stdout MUST be discarded (`stdout: "ignore"`).** VERIFIED empirically: the dev launcher writes `[LAUNCHER] …` lines to **stdout** before our app code runs, independent of us. Inheriting it would corrupt JSON-RPC. (This is the empirical proof that the two-process split is mandatory.)
- **Spawn target = the `dev` build.** `build/dev-macos-arm64/<name>-dev.app` is a flat bundle with `Contents/MacOS/launcher` + a flat `bun` + `Resources/app/bun/index.js`, directly spawnable with env passthrough. Canary/stable bundles are self-extracting wrappers (not a simple exec target) — do NOT target them.
- **window↔webview = Electroview RPC** (spec §3 "treść przez RPC"). SVG content pushed `win.webview.rpc.send.*`; webview events come back via `electroview.rpc!.send.*` → socket → `BridgeLike`.
- **Native-only.** The Phase 1 WebSocket bridge (`ViewerBridge`) and browser `index.html` are removed. UI moves into the Electrobun webview.
- **Passive window:** `Utils.setDockIconVisible(false)` (→ `NSApplicationActivationPolicyAccessory`) + `activate: false`. Front (`win.activate()`) ONLY on `render` (new diagram), never on `show`.

## FROZEN — do NOT modify these files or their tests

`src/types.ts` (`BridgeLike` + `ViewerOutbound`/`ViewerInbound`), `src/diagram-service.ts`, `src/mcp-server.ts`, `src/version-store.ts`, `src/feedback-buffer.ts`, `test/diagram-service.test.ts`, `test/feedback-buffer.test.ts`, `test/version-store.test.ts`, `test/mcp-server.test.ts`, `test/fake-bridge.ts`. The new bridge implements `BridgeLike` and the same `render/show/reload ⇄ hello/request-show/flush` protocol, so none of these need changes.

## File structure

**Create:**
- `src/wire.ts` — pure newline-delimited-JSON codec (`encodeFrame` + `createFrameDecoder`). Shared by the server bridge and the Electrobun main. DRY.
- `src/unix-bridge.ts` — `UnixSocketBridge implements BridgeLike`: owns the `Bun.listen({unix})` listener, the framing, and the child-window lifecycle (lazy spawn + kill).
- `src/launcher-path.ts` — resolves the built Electrobun binary path, or `null` if not built yet.
- `test/wire.test.ts`, `test/unix-bridge.test.ts`, `test/launcher-path.test.ts`.
- `viewer-app/electrobun.config.ts`, `viewer-app/package.json`.
- `viewer-app/src/bun/index.ts` — Electrobun **main**: window, accessory mode, socket client, RPC relay, watchdog.
- `viewer-app/src/mainview/index.html` — webview markup + styles (lifted from Phase 1).
- `viewer-app/src/mainview/index.ts` — webview UI logic over Electroview RPC (refactor of the Phase 1 inline `<script>`).

**Modify:**
- `src/server.ts` — wire `UnixSocketBridge` + `resolveLauncherPath`; keep EOF/SIGTERM shutdown; `bridge.stop()` kills child + unlinks socket.
- `package.json` (root) — add `build:viewer` script.

**Delete:**
- `src/viewer-bridge.ts`, `test/viewer-bridge.test.ts`, `src/viewer/index.html` (replaced by the Electrobun viewer).

---

## Stage 0 — Ground truth (confirmed empirically; no exploration needed)

> A pre-plan probe scaffolded + built `electrobun@1.18.4-beta.5` on this machine. All values below are VERIFIED and baked into Stages 3–4. **No Bun bump is required** (build succeeded on local Bun 1.3.11; the `.app` bundles its own 1.3.13).

**Confirmed facts (do not re-derive):**
- Scaffold (non-interactive): `bunx electrobun@1.18.4-beta.5 init <template>` (templates incl. `hello-world`, `photo-booth`).
- App layout: `electrobun.config.ts`, `package.json`, `src/bun/index.ts` (bun main), `src/mainview/index.{ts,html,css}` (view). Bun entrypoint defaults to `src/bun/index.ts`; view entrypoint set via `build.views.<name>.entrypoint`; HTML/CSS shipped via `build.copy`.
- Build command: `electrobun build` (default `--env=dev`). Dev output: `build/dev-macos-arm64/<appName>-dev.app`.
- Internal binary: `Contents/MacOS/launcher` (`CFBundleExecutable`); flat `Contents/MacOS/bun` (1.3.13) + dylibs present.
- Env passthrough CONFIRMED: a child spawned `Bun.spawn([launcher], { env: { SEDNO_SOCK } })` reads `Bun.env.SEDNO_SOCK` inside the app.
- stdout pollution CONFIRMED: the dev launcher writes `[LAUNCHER] …` to **stdout** → we MUST spawn with `stdout: "ignore"`.

### Task 0 (optional sanity, ~3 min): reproduce a flat dev build locally

Skip if you trust the probe. Otherwise:

- [ ] **Step 1: Build a throwaway app and confirm the flat dev bundle + env**

```bash
mkdir -p /tmp/eb-sanity && cd /tmp/eb-sanity
bunx electrobun@1.18.4-beta.5 init hello-world
cd hello-world && bun install && ./node_modules/.bin/electrobun build
ls -la build/dev-macos-arm64/*.app/Contents/MacOS    # expect: launcher, bun, *.dylib
```
Expected: exit 0; `launcher` present. No commit (throwaway).

---

## Stage 1 — Wire protocol (pure, TDD)

### Task 1: `src/wire.ts` — newline-delimited JSON codec

**Files:**
- Create: `src/wire.ts`
- Test: `test/wire.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/wire.test.ts
import { expect, test } from "bun:test";
import { encodeFrame, createFrameDecoder } from "../src/wire";
import type { ViewerInbound } from "../src/types";

test("encodeFrame appends exactly one newline and is valid JSON", () => {
  const s = encodeFrame({ type: "hello" });
  expect(s.endsWith("\n")).toBe(true);
  expect(s.indexOf("\n")).toBe(s.length - 1);
  expect(JSON.parse(s.trim())).toEqual({ type: "hello" });
});

test("decoder yields one message per complete line", () => {
  const decode = createFrameDecoder<ViewerInbound>();
  const msgs = decode(encodeFrame({ type: "hello" }) + encodeFrame({ type: "request-show", id: "v2" }));
  expect(msgs).toEqual([{ type: "hello" }, { type: "request-show", id: "v2" }]);
});

test("decoder reassembles a message split across chunks", () => {
  const decode = createFrameDecoder<ViewerInbound>();
  const whole = encodeFrame({ type: "request-show", id: "v3" });
  const a = whole.slice(0, 10);
  const b = whole.slice(10);
  expect(decode(a)).toEqual([]);
  expect(decode(b)).toEqual([{ type: "request-show", id: "v3" }]);
});

test("decoder skips blank lines and malformed JSON without throwing", () => {
  const decode = createFrameDecoder<ViewerInbound>();
  const msgs = decode("\n{bad json}\n" + encodeFrame({ type: "hello" }));
  expect(msgs).toEqual([{ type: "hello" }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test ./test/wire.test.ts`
Expected: FAIL — `Cannot find module '../src/wire'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/wire.ts
import type { ViewerInbound, ViewerOutbound } from "./types";

// One JSON object per line. Lines are the framing; never embed a raw newline in the JSON.
export function encodeFrame(msg: ViewerOutbound | ViewerInbound): string {
  return JSON.stringify(msg) + "\n";
}

// Stateful decoder over a byte/string stream that may split or coalesce frames.
export function createFrameDecoder<T = unknown>(): (chunk: string) => T[] {
  let buf = "";
  return (chunk: string): T[] => {
    buf += chunk;
    const out: T[] = [];
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.length === 0) continue;
      try { out.push(JSON.parse(line) as T); } catch { /* skip malformed frame */ }
    }
    return out;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test ./test/wire.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/wire.ts test/wire.test.ts
git commit -m "feat: newline-delimited JSON wire codec for unix-socket bridge"
```

---

## Stage 2 — Unix-socket bridge (TDD)

### Task 2: `src/unix-bridge.ts` — `UnixSocketBridge implements BridgeLike`

**Files:**
- Create: `src/unix-bridge.ts`
- Test: `test/unix-bridge.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/unix-bridge.test.ts
import { afterEach, expect, test } from "bun:test";
import { UnixSocketBridge } from "../src/unix-bridge";
import { encodeFrame, createFrameDecoder } from "../src/wire";
import type { Comment, ViewerOutbound } from "../src/types";

// A spawn stub that records calls and never starts a real process.
function fakeSpawn() {
  const calls: { cmd: string[]; env: Record<string, string | undefined> }[] = [];
  let resolveExit: () => void = () => {};
  const child = {
    exited: new Promise<void>((r) => { resolveExit = r; }),
    kill() { resolveExit(); },
  };
  const spawn = ((cmd: string[], opts: any) => { calls.push({ cmd, env: opts.env }); return child as any; }) as any;
  return { spawn, calls, child };
}

let bridge: UnixSocketBridge | null = null;
afterEach(() => { bridge?.stop(); bridge = null; });

function waitFor(pred: () => boolean, ms = 1000): Promise<void> {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const tick = () => pred() ? res() : (Date.now() - t0 > ms ? rej(new Error("timeout")) : setTimeout(tick, 5));
    tick();
  });
}

test("broadcast(render) lazily spawns the viewer exactly once, with SEDNO_SOCK in env", () => {
  const { spawn, calls } = fakeSpawn();
  bridge = new UnixSocketBridge({ launcherPath: "/fake/launcher", spawn });
  bridge.broadcast({ type: "render", version: { id: "v1", basedOn: null, createdAt: 0 }, svg: "<svg/>", history: [] });
  bridge.broadcast({ type: "render", version: { id: "v2", basedOn: null, createdAt: 0 }, svg: "<svg/>", history: [] });
  expect(calls.length).toBe(1);
  expect(calls[0]!.cmd).toEqual(["/fake/launcher"]);
  expect(calls[0]!.env.SEDNO_SOCK).toBe(bridge.sockPath);
});

test("a real connecting client receives broadcasts and its frames fire the callbacks", async () => {
  const { spawn } = fakeSpawn();
  bridge = new UnixSocketBridge({ launcherPath: "/fake/launcher", spawn });
  await bridge.start();

  let helloed = false;
  let shown: string | null = null;
  let flushed: Comment[] | null = null;
  bridge.onHello = () => { helloed = true; };
  bridge.onRequestShow = (id) => { shown = id; };
  bridge.onFlush = (c) => { flushed = c; };

  const received: ViewerOutbound[] = [];
  const decode = createFrameDecoder<ViewerOutbound>();
  const client = await Bun.connect({
    unix: bridge.sockPath,
    socket: { data(_s, d) { for (const m of decode(d.toString())) received.push(m); } },
  });

  // client -> server
  client.write(encodeFrame({ type: "hello" }));
  client.write(encodeFrame({ type: "request-show", id: "v3" }));
  client.write(encodeFrame({ type: "flush", comments: [{ versionId: "v1", target: { kind: "global" }, text: "hi" }] }));
  await waitFor(() => helloed && shown === "v3" && flushed !== null);
  expect(shown).toBe("v3");
  expect(flushed).toEqual([{ versionId: "v1", target: { kind: "global" }, text: "hi" }]);

  // server -> client
  bridge.broadcast({ type: "show", version: { id: "v3", basedOn: null, createdAt: 0 }, svg: "<svg id='x'/>" });
  await waitFor(() => received.some((m) => m.type === "show"));
  expect(received.find((m) => m.type === "show")).toMatchObject({ type: "show", svg: "<svg id='x'/>" });
  client.end();
});

test("stop() unlinks the socket file", async () => {
  const { spawn } = fakeSpawn();
  bridge = new UnixSocketBridge({ launcherPath: "/fake/launcher", spawn });
  await bridge.start();
  const path = bridge.sockPath;
  expect(await Bun.file(path).exists()).toBe(true);
  bridge.stop();
  bridge = null;
  expect(await Bun.file(path).exists()).toBe(false);
});

test("ensureViewer no-ops when launcherPath is null (server runs without a window)", () => {
  bridge = new UnixSocketBridge({ launcherPath: null });
  bridge.broadcast({ type: "render", version: { id: "v1", basedOn: null, createdAt: 0 }, svg: "<svg/>", history: [] });
  expect(true).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test ./test/unix-bridge.test.ts`
Expected: FAIL — `Cannot find module '../src/unix-bridge'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/unix-bridge.ts
import type { Subprocess } from "bun";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { BridgeLike, Comment, ViewerInbound, ViewerOutbound } from "./types";
import { createFrameDecoder, encodeFrame } from "./wire";

type SpawnFn = typeof Bun.spawn;

export interface UnixSocketBridgeOptions {
  // Absolute path to the built Electrobun binary (.app/Contents/MacOS/launcher), or null if not built.
  launcherPath: string | null;
  // Injectable for tests; defaults to Bun.spawn.
  spawn?: SpawnFn;
}

export class UnixSocketBridge implements BridgeLike {
  private listener: ReturnType<typeof Bun.listen> | null = null;
  private client: { write(data: string): number } | null = null;
  private child: Subprocess | null = null;
  private readonly dir: string;
  readonly sockPath: string;

  onFlush: (comments: Comment[]) => void = () => {};
  onRequestShow: (id: string) => void = () => {};
  onHello: () => void = () => {};

  constructor(private opts: UnixSocketBridgeOptions) {
    this.dir = mkdtempSync(join(tmpdir(), "sedno-")); // 0700 by default
    this.sockPath = join(this.dir, "viewer.sock");
  }

  async start(): Promise<void> {
    const self = this;
    const decode = createFrameDecoder<ViewerInbound>();
    this.listener = Bun.listen({
      unix: this.sockPath,
      socket: {
        open(socket) { self.client = socket; },
        data(_socket, data) { for (const msg of decode(data.toString())) self.dispatch(msg); },
        close() { self.client = null; },
      },
    });
  }

  private dispatch(msg: ViewerInbound): void {
    if (msg.type === "flush") this.onFlush(msg.comments);
    else if (msg.type === "request-show") this.onRequestShow(msg.id);
    else if (msg.type === "hello") this.onHello();
  }

  broadcast(msg: ViewerOutbound): void {
    if (msg.type === "render") this.ensureViewer();
    this.client?.write(encodeFrame(msg));
  }

  // Lazily spawn the window; idempotent while a child is alive; respawns after the window closes.
  ensureViewer(): void {
    if (this.opts.launcherPath === null) return; // no built viewer — server runs windowless
    if (this.child) return;
    const spawn = this.opts.spawn ?? Bun.spawn;
    const child = spawn([this.opts.launcherPath], {
      env: { ...process.env, SEDNO_SOCK: this.sockPath },
      stdin: "ignore",
      stdout: "ignore", // CRITICAL: the dev launcher prints [LAUNCHER] chatter to stdout; never wire it to ours
      stderr: "inherit", // child errors surface on OUR stderr (safe — not the protocol stream)
    });
    this.child = child;
    child.exited.then(() => { if (this.child === child) this.child = null; });
  }

  stop(): void {
    try { this.child?.kill(); } catch { /* already gone */ }
    this.child = null;
    this.listener?.stop(true);
    this.listener = null;
    try { rmSync(this.dir, { recursive: true, force: true }); } catch { /* already gone */ }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test ./test/unix-bridge.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/unix-bridge.ts test/unix-bridge.test.ts
git commit -m "feat: UnixSocketBridge (BridgeLike over a unix socket + lazy child spawn)"
```

---

## Stage 3 — Server wiring + remove the browser path

### Task 3: `src/launcher-path.ts` — resolve the built viewer binary

**Files:**
- Create: `src/launcher-path.ts`
- Test: `test/launcher-path.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/launcher-path.test.ts
import { expect, test } from "bun:test";
import { resolveLauncherPath } from "../src/launcher-path";

test("returns null when the viewer is not built", () => {
  expect(resolveLauncherPath("/definitely/not/a/repo")).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test ./test/launcher-path.test.ts`
Expected: FAIL — `Cannot find module '../src/launcher-path'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/launcher-path.ts
import { existsSync } from "fs";
import { join } from "path";

// Path to the built Electrobun viewer binary, relative to the repo root, or null if not built.
// CONFIRMED dev-build layout: build/dev-macos-arm64/<appName>-dev.app/Contents/MacOS/launcher
// appName is "sedno-viewer" (electrobun.config.ts), so the dev bundle is "sedno-viewer-dev.app".
export function resolveLauncherPath(repoRoot: string = join(import.meta.dir, "..")): string | null {
  const candidate = join(
    repoRoot,
    "viewer-app", "build", "dev-macos-arm64", "sedno-viewer-dev.app", "Contents", "MacOS", "launcher",
  );
  return existsSync(candidate) ? candidate : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test ./test/launcher-path.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/launcher-path.ts test/launcher-path.test.ts
git commit -m "feat: resolve built Electrobun viewer binary path (dev bundle)"
```

### Task 4: Rewire `src/server.ts`, delete the browser path

**Files:**
- Modify: `src/server.ts`
- Delete: `src/viewer-bridge.ts`, `test/viewer-bridge.test.ts`, `src/viewer/index.html`

- [ ] **Step 1: Replace `src/server.ts` with the Unix-socket composition root**

```ts
// src/server.ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { VersionStore } from "./version-store";
import { FeedbackBuffer } from "./feedback-buffer";
import { UnixSocketBridge } from "./unix-bridge";
import { resolveLauncherPath } from "./launcher-path";
import { DiagramService } from "./diagram-service";
import { buildMcpServer } from "./mcp-server";

// WAŻNE: logi WYŁĄCZNIE na stderr — stdout należy do JSON-RPC.
const log = (...a: unknown[]) => console.error("[sedno]", ...a);

async function main() {
  const store = new VersionStore();
  const buffer = new FeedbackBuffer();

  const launcherPath = resolveLauncherPath();
  if (launcherPath === null) {
    log("viewer app not built — run `bun run build:viewer`; rendering will be windowless until then");
  }

  const bridge = new UnixSocketBridge({ launcherPath });
  await bridge.start();
  log("viewer socket at", bridge.sockPath);

  const service = new DiagramService(store, buffer, bridge, {
    onFirstRender: () => bridge.ensureViewer(),
  });

  const server = buildMcpServer(service);

  let shuttingDown = false;
  const shutdown = (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("shutting down:", sig);
    bridge.stop(); // kills the window child + unlinks the socket
    process.exit(0);
  };

  const transport = new StdioServerTransport();
  transport.onclose = () => shutdown("transport-closed");
  await server.connect(transport);
  log("MCP server connected over stdio");

  // Pod Bun transport.onclose nie odpala się niezawodnie na EOF stdin — nasłuchujemy jawnie.
  // Listenery 'end'/'close' są pasywne (nie konsumują bajtów), więc nie kolidują z transportem.
  process.stdin.on("end", () => shutdown("stdin-end"));
  process.stdin.on("close", () => shutdown("stdin-close"));

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((e) => {
  console.error("[sedno] fatal:", e);
  process.exit(1);
});
```

- [ ] **Step 2: Delete the obsolete browser-path files**

```bash
git rm src/viewer-bridge.ts test/viewer-bridge.test.ts src/viewer/index.html
```

- [ ] **Step 3: Run the full suite + typecheck**

Run: `bun test && bun run typecheck`
Expected: all tests PASS (frozen Phase 1 tests + `wire`, `unix-bridge`, `launcher-path`); typecheck clean. No reference to `ViewerBridge` remains.

- [ ] **Step 4: Smoke-test the stdio server emits clean JSON-RPC**

Run:
```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' | bun run src/server.ts 2>/dev/null | head -c 400
```
Expected: a single JSON-RPC line on **stdout** whose `result.serverInfo.name` is `"sedno"` — and NOTHING else on stdout (logs went to stderr, suppressed by `2>/dev/null`).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: wire server to UnixSocketBridge; remove browser viewer path"
```

---

## Stage 4 — Electrobun viewer app

> All scaffold specifics below are the CONFIRMED ground truth from Stage 0. The code is written against the VERIFIED `electrobun@1.18.4-beta.5` API (matches the `photo-booth` template's RPC wiring).

### Task 5: Scaffold the `viewer-app/` sub-project

**Files:**
- Create: `viewer-app/package.json`
- Create: `viewer-app/electrobun.config.ts`

- [ ] **Step 1: `viewer-app/package.json`**

```json
{
  "name": "sedno-viewer",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "electrobun dev",
    "build": "electrobun build"
  },
  "dependencies": {
    "electrobun": "1.18.4-beta.5"
  }
}
```

- [ ] **Step 2: `viewer-app/electrobun.config.ts`** (shape verbatim-confirmed from the template)

```ts
// viewer-app/electrobun.config.ts
import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "sedno-viewer",
    identifier: "sh.sedno.viewer",
    version: "0.1.0",
  },
  build: {
    // bun.entrypoint defaults to "src/bun/index.ts" — left implicit, like the templates.
    views: {
      mainview: {
        entrypoint: "src/mainview/index.ts",
      },
    },
    copy: {
      "src/mainview/index.html": "views/mainview/index.html",
    },
    mac: { bundleCEF: false },
    linux: { bundleCEF: false },
    win: { bundleCEF: false },
  },
} satisfies ElectrobunConfig;
```

- [ ] **Step 3: Install + commit**

```bash
cd viewer-app && bun install && cd ..
git add viewer-app/package.json viewer-app/electrobun.config.ts viewer-app/bun.lock
git commit -m "feat: scaffold Electrobun viewer-app sub-project"
```

### Task 6: Electrobun **main** — `viewer-app/src/bun/index.ts`

**Files:**
- Create: `viewer-app/src/bun/index.ts`

> Cross-imports `../../../src/wire` and `../../../src/types` (DRY). `Bun.build({target:"bun"})` bundles them. If the bundler cannot resolve the cross-dir import, copy `src/wire.ts` → `viewer-app/src/bun/wire.ts` and inline the two `VersionMeta`/`Comment` type aliases.

- [ ] **Step 1: Write the main process**

```ts
// viewer-app/src/bun/index.ts
import { BrowserWindow, BrowserView, Utils, type RPCSchema } from "electrobun/bun";
import type { Socket } from "bun";
import { encodeFrame, createFrameDecoder } from "../../../src/wire";
import type { Comment, ViewerInbound, ViewerOutbound, VersionMeta } from "../../../src/types";

// Shared RPC schema (imported by the webview via `import type`).
export type SednoRPC = {
  bun: RPCSchema<{
    requests: {};
    messages: {
      ready: { params: {} };
      requestShow: { params: { id: string } };
      flush: { params: { comments: Comment[] } };
    };
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: {
      render: { params: { version: VersionMeta; svg: string; history: VersionMeta[] } };
      show: { params: { version: VersionMeta; svg: string } };
      reload: { params: {} };
    };
  }>;
};

const SOCK = Bun.env.SEDNO_SOCK;
if (!SOCK) {
  console.error("[sedno-viewer] missing SEDNO_SOCK; quitting");
  Utils.quit();
}

let client: Socket<unknown> | null = null;

function sendToServer(msg: ViewerInbound): void {
  client?.write(encodeFrame(msg));
}

// Bun side handles webview->bun messages and relays them to the server socket.
const rpc = BrowserView.defineRPC<SednoRPC>({
  maxRequestTime: 5000,
  handlers: {
    requests: {},
    messages: {
      ready: () => sendToServer({ type: "hello" }),
      requestShow: ({ id }) => sendToServer({ type: "request-show", id }),
      flush: ({ comments }) => sendToServer({ type: "flush", comments }),
    },
  },
});

const win = new BrowserWindow({
  title: "sedno — diagram",
  url: "views://mainview/index.html",
  frame: { x: 120, y: 120, width: 1040, height: 720 },
  activate: false, // do not steal focus on initial open
  rpc,
});

Utils.setDockIconVisible(false); // accessory: NSApplicationActivationPolicyAccessory, no Dock icon

function handleFromServer(msg: ViewerOutbound): void {
  if (msg.type === "render") {
    win.webview.rpc.send.render({ version: msg.version, svg: msg.svg, history: msg.history });
    win.activate(); // front ONLY on a new diagram
  } else if (msg.type === "show") {
    win.webview.rpc.send.show({ version: msg.version, svg: msg.svg });
  } else if (msg.type === "reload") {
    win.webview.rpc.send.reload({});
  }
}

const decode = createFrameDecoder<ViewerOutbound>();

async function connectWithWatchdog(attempt = 0): Promise<void> {
  try {
    client = await Bun.connect({
      unix: SOCK!,
      socket: {
        open(socket) { client = socket; sendToServer({ type: "hello" }); },
        data(_socket, data) { for (const m of decode(data.toString())) handleFromServer(m); },
        close() { Utils.quit(); }, // watchdog: server gone
        end() { Utils.quit(); },
        error() { Utils.quit(); },
      },
    });
  } catch {
    // boot race: the listener may not be up yet. Retry briefly, then give up.
    if (attempt < 50) { setTimeout(() => connectWithWatchdog(attempt + 1), 100); return; }
    console.error("[sedno-viewer] could not connect to server socket; quitting");
    Utils.quit();
  }
}

await connectWithWatchdog();
```

> **At build, confirm:** `win.webview.rpc.send.<msg>(...)` (bun→view) — if the typed accessor requires it, use `win.webview.rpc?.send...`. The `electrobun/bun` import set + `BrowserView.defineRPC<Schema>` + `messages` handler shape match the verified `photo-booth` template.

- [ ] **Step 2: Typecheck the repo (the main cross-imports shared `src/wire.ts`/`src/types.ts`)**

Run: `bun run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add viewer-app/src/bun/index.ts
git commit -m "feat: Electrobun main — socket client, RPC relay, watchdog, accessory window"
```

### Task 7: Electrobun **webview** — `viewer-app/src/mainview/`

**Files:**
- Create: `viewer-app/src/mainview/index.html`
- Create: `viewer-app/src/mainview/index.ts`

> Markup + styles lifted verbatim from Phase 1 `src/viewer/index.html` (known-good). The ONLY change is the transport: the inline WebSocket client becomes Electroview RPC. The HTML loads the compiled view entry as `index.js` (entrypoint `index.ts` → `views/mainview/index.js`).

- [ ] **Step 1: `viewer-app/src/mainview/index.html`**

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

  <script type="module" src="index.js"></script>
</body>
</html>
```

- [ ] **Step 2: `viewer-app/src/mainview/index.ts`** (Phase 1 UI logic, transport = Electroview RPC)

```ts
// viewer-app/src/mainview/index.ts
import Electrobun, { Electroview } from "electrobun/view";
import type { SednoRPC } from "../bun/index";

type VersionMeta = { id: string; title?: string; basedOn: string | null; createdAt: number };
type CommentTarget = { kind: "element"; id: string } | { kind: "region"; ids: string[] } | { kind: "global" };
type Comment = { versionId: string | null; target: CommentTarget; text: string };

const stage = document.getElementById("stage")!;
const timelineEl = document.getElementById("timeline")!;
const statusEl = document.getElementById("status")!;
const curLabel = document.getElementById("curLabel")!;
const queueEl = document.getElementById("queue")!;
const sendBtn = document.getElementById("sendBtn") as HTMLButtonElement;
const globalBtn = document.getElementById("globalBtn")!;
const popover = document.getElementById("popover")!;
const popTarget = document.getElementById("popTarget")!;
const popText = document.getElementById("popText") as HTMLTextAreaElement;

let currentVersionId: string | null = null;
let queue: Comment[] = [];
let activeTarget: CommentTarget | null = null;

function setStatus(t: string, ok: boolean) { statusEl.textContent = t; statusEl.className = "status" + (ok ? " ok" : ""); }
function clearChildren(el: Element) { while (el.firstChild) el.removeChild(el.firstChild); }
function emptyMsg(text: string) { const d = document.createElement("div"); d.className = "empty"; d.textContent = text; return d; }

function setCurrent(version: VersionMeta) {
  currentVersionId = version.id;
  curLabel.textContent = version.id + (version.title ? " · " + version.title : "");
}

// Safe SVG insertion: parse as XML and import the node (no HTML property side effects).
function swapSvg(svg: string) {
  clearChildren(stage);
  if (!svg) { stage.appendChild(emptyMsg("Pusty diagram.")); markCommented(); return; }
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() === "parsererror") { stage.appendChild(emptyMsg("Błąd parsowania SVG.")); return; }
  stage.appendChild(document.importNode(root, true));
  markCommented();
}

function renderTimeline(history: VersionMeta[], currentId: string) {
  clearChildren(timelineEl);
  (history || []).forEach((v) => {
    const li = document.createElement("li");
    li.dataset.id = v.id;
    if (v.id === currentId) li.className = "current";
    const label = document.createElement("span");
    label.textContent = v.id + (v.title ? " · " + v.title : "");
    li.appendChild(label);
    if (v.basedOn) { const b = document.createElement("span"); b.className = "based"; b.textContent = "← " + v.basedOn; li.appendChild(b); }
    timelineEl.appendChild(li);
  });
}
function markCurrentInTimeline(id: string) {
  Array.prototype.forEach.call(timelineEl.children, (li: HTMLElement) => { li.className = li.dataset.id === id ? "current" : ""; });
}

function openPopover(target: CommentTarget, x: number, y: number) {
  activeTarget = target;
  popTarget.textContent = target.kind === "global" ? "Komentarz ogólny" : "Element: " + (target as { id: string }).id;
  popText.value = "";
  popover.style.left = Math.min(x, window.innerWidth - 300) + "px";
  popover.style.top = Math.min(y, window.innerHeight - 220) + "px";
  popover.classList.add("open");
  popText.focus();
}
function closePopover() { popover.classList.remove("open"); activeTarget = null; }

function updateQueue() {
  queueEl.textContent = queue.length + (queue.length === 1 ? " komentarz" : " komentarzy") + " w kolejce";
  sendBtn.disabled = queue.length === 0;
}
function markCommented() {
  const ids: Record<string, boolean> = {};
  queue.forEach((cm) => { if (cm.versionId === currentVersionId && cm.target.kind === "element") ids[cm.target.id] = true; });
  Array.prototype.forEach.call(stage.querySelectorAll("[data-node-id],[data-edge-id]"), (el: Element) => {
    const id = el.getAttribute("data-node-id") || el.getAttribute("data-edge-id") || "";
    if (ids[id]) el.setAttribute("data-commented", "1"); else el.removeAttribute("data-commented");
  });
}

// --- transport: Electroview RPC (bun main relays to/from the server socket) ---
const rpc = Electroview.defineRPC<SednoRPC>({
  maxRequestTime: 5000,
  handlers: {
    requests: {},
    messages: {
      render: ({ version, svg, history }) => {
        setStatus("połączono", true); swapSvg(svg); setCurrent(version); renderTimeline(history, version.id);
      },
      show: ({ version, svg }) => {
        swapSvg(svg); setCurrent(version); markCurrentInTimeline(version.id);
      },
      reload: () => location.reload(),
    },
  },
});
const electroview = new Electrobun.Electroview({ rpc });

// --- UI events -> RPC -> bun main -> server socket ---
timelineEl.addEventListener("click", (ev) => {
  const li = (ev.target as Element).closest("li") as HTMLElement | null;
  if (li && li.dataset.id) electroview.rpc!.send.requestShow({ id: li.dataset.id });
});
stage.addEventListener("click", (ev) => {
  const el = (ev.target as Element).closest("[data-node-id],[data-edge-id]");
  if (!el) return;
  const id = el.getAttribute("data-node-id") || el.getAttribute("data-edge-id") || "";
  openPopover({ kind: "element", id }, (ev as MouseEvent).clientX, (ev as MouseEvent).clientY);
});
globalBtn.addEventListener("click", () => openPopover({ kind: "global" }, window.innerWidth - 320, 120));
Array.prototype.forEach.call(popover.querySelectorAll(".chips button"), (b: HTMLElement) => {
  b.addEventListener("click", () => { popText.value = ((b.dataset.emoji || "") + " " + popText.value).replace(/^\s+/, ""); popText.focus(); });
});
document.getElementById("popCancel")!.addEventListener("click", closePopover);
document.getElementById("popAdd")!.addEventListener("click", () => {
  const text = popText.value.trim();
  if (!text || !activeTarget) { closePopover(); return; }
  queue.push({ versionId: currentVersionId, target: activeTarget, text });
  updateQueue(); closePopover(); markCommented();
});
sendBtn.addEventListener("click", () => {
  if (queue.length === 0) return;
  electroview.rpc!.send.flush({ comments: queue.slice() });
  queue = []; updateQueue(); markCommented();
});

// Tell the bun main we are mounted so it asks the server to (re)send current state.
electroview.rpc!.send.ready({});
```

- [ ] **Step 3: Commit**

```bash
git add viewer-app/src/mainview/index.html viewer-app/src/mainview/index.ts
git commit -m "feat: Electrobun webview UI over Electroview RPC (port of Phase 1 viewer)"
```

### Task 8: Root `build:viewer` script

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Add the build script**

In root `package.json` `scripts`, add (keep existing `start`/`test`/`typecheck`):

```json
    "build:viewer": "cd viewer-app && bun install && bun run build"
```

- [ ] **Step 2: Build the viewer for real**

Run: `bun run build:viewer`
Expected: produces `viewer-app/build/dev-macos-arm64/sedno-viewer-dev.app/Contents/MacOS/launcher`. If the path differs, fix `src/launcher-path.ts` to match and re-run `bun test ./test/launcher-path.test.ts`.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "build: add build:viewer script"
```

---

## Stage 5 — End-to-end verification (manual, required)

### Task 9: Full native loop + orphan-cleanup proof

**Files:** none (verification only).

- [ ] **Step 1: Build + confirm the suite is green**

Run: `bun run build:viewer && bun test && bun run typecheck`
Expected: `.app` built; all tests pass; typecheck clean.

- [ ] **Step 2: Confirm stdout stays clean JSON-RPC with the window in play**

The dev launcher prints `[LAUNCHER]` to ITS stdout, but we spawn it `stdout: "ignore"`, so OUR stdout must remain pure JSON-RPC:

```bash
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"render_diagram","arguments":{"svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"80\"><rect data-node-id=\"a\" x=\"10\" y=\"10\" width=\"180\" height=\"60\" fill=\"#234\"/></svg>","title":"smoke"}}}' \
  | bun run src/server.ts 2>/dev/null
```
Expected: ONLY JSON-RPC lines on stdout (each line parses as JSON; no `[LAUNCHER]` text); a native window appears showing the rectangle, raised to front, with NO Dock icon.

- [ ] **Step 3: Manual interaction round-trip**

Configure the project in Claude Code (`.mcp.json` unchanged). In a session: ask Claude to render a diagram → window appears front. Click a node → popover → add a comment → "Wyślij do Claude". Then type "zobacz teraz" → Claude calls `get_feedback` → confirm the comment text + target id + versionId arrive. Render again → window comes to front; call `show_version` for an older id → window switches WITHOUT coming to front.

- [ ] **Step 4: Orphan-cleanup proof (the headline guarantee)**

```bash
# With a session running and the window open:
pgrep -fl 'sedno-viewer'     # expect the launcher/bun viewer process listed
# End the Claude session (quit / close), then:
pgrep -fl 'sedno-viewer'     # expect: NOTHING
```
Also test the crash path: `kill -9` the server (`pgrep -f 'src/server.ts'`) and confirm the window self-quits within ~1s (watchdog) and `pgrep` shows no viewer.

- [ ] **Step 5: No `console.log` in `src/` (hygiene gate)**

Run: `grep -rn "console.log" src/`
Expected: NO output (all logs use `console.error`).

- [ ] **Step 6: Commit any fixes found during verification**

```bash
git add -A && git commit -m "fix: address Phase 2 e2e findings"   # only if changes were needed
```

---

## Self-review checklist (run before handoff)

**1. Spec coverage (§3/§7/§9/§10/§13):**
- Two processes, server pure Bun owns stdio → Stage 3 (`server.ts`, front door unchanged) + Stage 4 (separate `.app`). ✓
- stdout contamination mitigation: child spawned `stdout: "ignore"` (Task 2) — EMPIRICALLY justified by the `[LAUNCHER]` stdout chatter (Stage 0); hygiene grep (Task 9 Step 5). ✓
- Lazy-spawn via internal binary, not `open`: `ensureViewer` exec's `launcherPath` (Task 2); `resolveLauncherPath` → dev bundle (Task 3). ✓
- Server↔window comms + access control: Unix socket in `0700` dir, no token (Task 2). *(Deviation from spec's literal "WS + token", agreed during design: the Unix socket removes the listening port, so the token is unnecessary; documented in "Decisions locked".)* ✓
- Single persistent window, content via RPC, events → bridge: Task 6 (RPC relay). ✓
- Passive `.accessory` + front only on new diagram: `Utils.setDockIconVisible(false)`, `activate:false`, `win.activate()` on `render` only (Task 6). ✓
- Watchdog + server kills child on EOF/SIGTERM: socket `close/end/error → Utils.quit()` (Task 6); `bridge.stop()` on shutdown (Task 4); proven in Task 9 Step 4. ✓
- Frozen contract (tools/resources/identity/concurrency): no edits to the frozen file set; verified by Task 4 Step 3 green suite. ✓

**2. Placeholder scan:** All scaffold specifics are now CONFIRMED ground truth (Stage 0). The only "confirm at build" notes (`win.webview.rpc.send` optional-chaining; cross-dir import fallback) are concrete fallbacks, not hand-waved logic. ✓

**3. Type consistency:** `encodeFrame`/`createFrameDecoder` (Task 1) used identically in Task 2 and Task 6. `sockPath` (public, Task 2) read in tests, never reassigned. `ViewerOutbound`/`ViewerInbound`/`VersionMeta`/`Comment` from frozen `src/types.ts` used unchanged across bridge + main. `ensureViewer`/`stop`/`broadcast` names match between `unix-bridge.ts` and `server.ts`. `SednoRPC` defined in `viewer-app/src/bun/index.ts`, imported via `import type` in `viewer-app/src/mainview/index.ts`. RPC message names (`render`/`show`/`reload` bun→webview; `ready`/`requestShow`/`flush` webview→bun) match between main and view. ✓
