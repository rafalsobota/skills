import { expect, test } from "bun:test";
import { SocketWriter } from "../src/socket-writer";

function fakeSocket(acceptPerWrite: number[]) {
  const written: number[] = [];
  const chunks: number[] = []; // the actual bytes the socket accepted, in order
  let i = 0;
  return {
    written,
    chunks,
    socket: {
      write(data: Uint8Array): number {
        const cap = i < acceptPerWrite.length ? acceptPerWrite[i]! : data.length;
        i++;
        const n = Math.min(cap, data.length);
        written.push(n);
        chunks.push(...data.subarray(0, n));
        return n;
      },
    },
  };
}

test("full write passes straight through, no queue", () => {
  const f = fakeSocket([100]);
  const w = new SocketWriter(f.socket);
  w.write(new Uint8Array(10));
  expect(w.pending).toBe(0);
  expect(f.written).toEqual([10]);
});

test("short write buffers the remainder; drain flushes it", () => {
  const f = fakeSocket([4, 0, 100]);
  const w = new SocketWriter(f.socket);
  w.write(new Uint8Array(10)); // accepts 4, buffers 6
  expect(w.pending).toBe(6);
  w.drain();                   // accepts 0, still 6
  expect(w.pending).toBe(6);
  w.drain();                   // accepts all 6
  expect(w.pending).toBe(0);
});

test("writes while backpressured are queued in FIFO order", () => {
  const f = fakeSocket([0]); // first write accepts nothing
  const w = new SocketWriter(f.socket);
  w.write(Uint8Array.of(1, 2, 3));
  w.write(Uint8Array.of(4, 5));
  expect(w.pending).toBe(5);
  w.drain(); // capacity restored (subsequent writes accept everything)
  expect(w.pending).toBe(0);
  expect(f.chunks).toEqual([1, 2, 3, 4, 5]); // flushed byte-for-byte in FIFO order
});
