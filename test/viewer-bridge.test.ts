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
