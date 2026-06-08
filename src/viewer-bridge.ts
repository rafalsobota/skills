import type { Server } from "bun";
import { join } from "path";
import type { BridgeLike, Comment, ViewerInbound, ViewerOutbound } from "./types";

const VIEWER_HTML_PATH = join(import.meta.dir, "viewer", "index.html");
const TOPIC = "viewers";

export class ViewerBridge implements BridgeLike {
  private server: Server<undefined> | null = null;
  private html = "";

  onFlush: (comments: Comment[]) => void = () => {};
  onRequestShow: (id: string) => void = () => {};
  onHello: () => void = () => {};

  async start(): Promise<void> {
    this.html = await Bun.file(VIEWER_HTML_PATH).text();
    const self = this;
    this.server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, server) {
        const url = new URL(req.url);
        if (url.pathname === "/ws") {
          if (server.upgrade(req)) return undefined; // po sukcesie MUSI zwrócić undefined
          return new Response("upgrade failed", { status: 400 });
        }
        return new Response(self.html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      },
      websocket: {
        open(ws) { ws.subscribe(TOPIC); },
        message(ws, raw) {
          let msg: ViewerInbound;
          try { msg = JSON.parse(String(raw)) as ViewerInbound; } catch { return; }
          if (msg.type === "flush") self.onFlush(msg.comments);
          else if (msg.type === "request-show") self.onRequestShow(msg.id);
          else if (msg.type === "hello") self.onHello();
        },
        close(ws) { ws.unsubscribe(TOPIC); },
      },
    });
  }

  get url(): string {
    if (!this.server) throw new Error("bridge not started");
    return this.server.url.href;
  }

  broadcast(msg: ViewerOutbound): void {
    this.server?.publish(TOPIC, JSON.stringify(msg));
  }

  stop(): void {
    this.server?.stop(true); // wymuś zamknięcie aktywnych połączeń (inaczej runner może zawisnąć)
    this.server = null;
  }
}
