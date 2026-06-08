// src/wire.ts
import type { ViewerInbound, ViewerOutbound } from "./types";

// One JSON object per line. Lines are the framing; never embed a raw newline in the JSON.
export function encodeFrame(msg: ViewerOutbound | ViewerInbound): string {
  return JSON.stringify(msg) + "\n";
}

// Accepts raw socket bytes (Uint8Array) and decodes with a STREAMING UTF-8 decoder,
// so a multibyte character split across socket reads is reassembled correctly.
// Also accepts strings (already-decoded input, e.g. tests).
export function createFrameDecoder<T = unknown>(): (chunk: Uint8Array | string) => T[] {
  const decoder = new TextDecoder();
  let buf = "";
  return (chunk: Uint8Array | string): T[] => {
    buf += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
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
