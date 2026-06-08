import type { VersionStore } from "./version-store";
import type { FeedbackBuffer } from "./feedback-buffer";
import type { BridgeLike, Comment, Version, VersionMeta } from "./types";

function meta(v: Version): VersionMeta {
  const { svg, ...m } = v;
  return m;
}

export interface DiagramServiceOptions {
  onFirstRender?: () => void;
}

export class DiagramService {
  private opened = false;

  constructor(
    private store: VersionStore,
    private buffer: FeedbackBuffer,
    private bridge: BridgeLike,
    private opts: DiagramServiceOptions = {},
  ) {
    bridge.onFlush = (comments) => {
      for (const c of comments) this.buffer.push(c);
    };
    bridge.onRequestShow = (id) => {
      try { this.showVersion(id); } catch { /* nieznane id ze starego widoku — ignoruj */ }
    };
    bridge.onHello = () => this.broadcastCurrent();
  }

  render(input: { svg: string; title?: string; basedOn?: string | null }): Version {
    if (!this.opened) {
      this.opened = true;
      this.opts.onFirstRender?.();
    }
    const v = this.store.add(input.svg, { title: input.title, basedOn: input.basedOn });
    this.bridge.broadcast({
      type: "render",
      version: meta(v),
      svg: v.svg,
      history: this.store.history(),
    });
    return v;
  }

  showVersion(id: string): Version {
    this.store.setCurrent(id);
    const v = this.store.get(id)!;
    this.bridge.broadcast({ type: "show", version: meta(v), svg: v.svg });
    return v;
  }

  getFeedback(): Comment[] {
    return this.buffer.drain();
  }

  peekFeedback(): readonly Comment[] {
    return this.buffer.peek();
  }

  currentVersion(): Version | null {
    return this.store.current;
  }

  getVersion(id: string): Version | undefined {
    return this.store.get(id);
  }

  history(): VersionMeta[] {
    return this.store.history();
  }

  private broadcastCurrent(): void {
    const v = this.store.current;
    if (!v) return;
    this.bridge.broadcast({
      type: "render",
      version: meta(v),
      svg: v.svg,
      history: this.store.history(),
    });
  }
}
