// test/unix-bridge.test.ts
import { afterEach, expect, test } from "bun:test";
import { existsSync } from "fs";
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
    socket: { data(_s, d) { for (const m of decode(d)) received.push(m); } },
  });

  // client -> server
  client.write(encodeFrame({ type: "hello" }));
  client.write(encodeFrame({ type: "request-show", id: "v3" }));
  client.write(encodeFrame({ type: "flush", comments: [{ versionId: "v1", target: { kind: "global" }, text: "hi" }] }));
  await waitFor(() => helloed && shown === "v3" && flushed !== null);
  expect(shown!).toBe("v3");
  expect(flushed!).toEqual([{ versionId: "v1", target: { kind: "global" }, text: "hi" }]);

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
  expect(existsSync(path)).toBe(true);
  bridge.stop();
  bridge = null;
  expect(existsSync(path)).toBe(false);
});

test("ensureViewer no-ops when launcherPath is null (server runs without a window)", () => {
  bridge = new UnixSocketBridge({ launcherPath: null });
  expect(() =>
    bridge!.broadcast({ type: "render", version: { id: "v1", basedOn: null, createdAt: 0 }, svg: "<svg/>", history: [] }),
  ).not.toThrow();
});

test("per-connection decoder reset: client A's partial frame does not corrupt client B", async () => {
  const { spawn } = fakeSpawn();
  bridge = new UnixSocketBridge({ launcherPath: "/fake/launcher", spawn });
  await bridge.start();

  let shown: string | null = null;
  bridge.onRequestShow = (id) => { shown = id; };

  // Client A writes a partial frame (no trailing newline), then disconnects.
  const a = await Bun.connect({ unix: bridge.sockPath, socket: { data() {} } });
  a.write('{"type":"hel');
  await waitFor(() => true); // let the server register A's bytes
  a.end();
  // Wait for the server to observe A's close before B connects.
  await waitFor(() => (bridge as any).connected === false);

  // Client B sends a complete frame; it must not be prefixed by A's leftover bytes.
  const b = await Bun.connect({ unix: bridge.sockPath, socket: { data() {} } });
  b.write(encodeFrame({ type: "request-show", id: "v9" }));
  await waitFor(() => shown !== null);
  expect(shown!).toBe("v9");
  b.end();
});

test("a large multibyte broadcast is delivered intact across many socket reads", async () => {
  const { spawn } = fakeSpawn();
  bridge = new UnixSocketBridge({ launcherPath: "/fake/launcher", spawn });
  await bridge.start();
  const received: ViewerOutbound[] = [];
  const decode = createFrameDecoder<ViewerOutbound>();
  const client = await Bun.connect({
    unix: bridge.sockPath,
    socket: { data(_s, d) { for (const m of decode(d)) received.push(m); } },
  });
  // ~200KB of multibyte text -> guaranteed to span many ~8KB socket reads.
  const big = "ąćż🔍✗✂️💬 relacja ".repeat(8000);
  bridge.broadcast({ type: "show", version: { id: "v1", basedOn: null, createdAt: 0 }, svg: big });
  await waitFor(() => received.some((m) => m.type === "show"), 5000);
  const got = received.find((m) => m.type === "show") as { svg: string };
  expect(got.svg).toBe(big); // byte-perfect: no mojibake, no truncation
  client.end();
});
