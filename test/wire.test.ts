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

test("decoder reassembles a multibyte char split across byte chunks", () => {
  const decode = createFrameDecoder<{ type: string; text: string }>();
  const bytes = new TextEncoder().encode(encodeFrame({ type: "x", text: "ąćż🔍" } as any));
  const cut = bytes.length - 2; // split inside the 4-byte 🔍
  expect(decode(bytes.subarray(0, cut))).toEqual([]);
  expect(decode(bytes.subarray(cut))).toEqual([{ type: "x", text: "ąćż🔍" }]);
});
