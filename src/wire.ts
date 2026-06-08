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
