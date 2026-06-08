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
  // Fresh per connection: a stale partial frame from a dead client must never prefix the next one.
  private decode: (chunk: Uint8Array | string) => ViewerInbound[] = createFrameDecoder<ViewerInbound>();
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
    this.listener = Bun.listen({
      unix: this.sockPath,
      socket: {
        open(socket) { self.client = socket; self.decode = createFrameDecoder<ViewerInbound>(); },
        data(_socket, data) { for (const msg of self.decode(data)) self.dispatch(msg); },
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
