// Backpressure-aware writer for a Bun socket. socket.write() can SHORT-WRITE under
// backpressure (returns fewer bytes than given, silently dropping the rest); we buffer
// the unwritten remainder and flush it from the socket's `drain` handler, preserving
// the integrity of the newline-delimited frame stream in both directions.
export interface WritableSocket {
  write(data: Uint8Array): number;
}

export class SocketWriter {
  private queue: Uint8Array[] = [];
  constructor(private socket: WritableSocket) {}

  write(bytes: Uint8Array): void {
    if (bytes.length === 0) return;
    if (this.queue.length > 0) { this.queue.push(bytes); return; } // preserve order behind backlog
    const n = this.socket.write(bytes);
    if (n < bytes.length) this.queue.push(bytes.subarray(n));
  }

  // Call from the socket's `drain` handler.
  drain(): void {
    while (this.queue.length > 0) {
      const head = this.queue[0]!;
      const n = this.socket.write(head);
      if (n < head.length) { this.queue[0] = head.subarray(n); return; }
      this.queue.shift();
    }
  }

  get pending(): number { return this.queue.reduce((s, b) => s + b.length, 0); }
}
