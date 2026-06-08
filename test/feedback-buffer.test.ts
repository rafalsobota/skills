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
