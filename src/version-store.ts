import type { Version, VersionMeta } from "./types";

export class VersionStore {
  private versions = new Map<string, Version>();
  private order: string[] = [];
  private currentId: string | null = null;

  add(svg: string, opts: { title?: string; basedOn?: string | null } = {}): Version {
    const id = `v${this.order.length + 1}`;
    const version: Version = {
      id,
      svg,
      title: opts.title,
      basedOn: opts.basedOn ?? null,
      createdAt: Date.now(),
    };
    this.versions.set(id, version);
    this.order.push(id);
    this.currentId = id;
    return version;
  }

  get(id: string): Version | undefined {
    return this.versions.get(id);
  }

  get current(): Version | null {
    return this.currentId ? this.versions.get(this.currentId) ?? null : null;
  }

  setCurrent(id: string): void {
    if (!this.versions.has(id)) throw new Error(`unknown version: ${id}`);
    this.currentId = id;
  }

  history(): VersionMeta[] {
    return this.order.map((id) => {
      const { svg, ...meta } = this.versions.get(id)!;
      return meta;
    });
  }

  lineage(id: string): VersionMeta[] {
    const chain: VersionMeta[] = [];
    let cur = this.versions.get(id);
    while (cur) {
      const { svg, ...meta } = cur;
      chain.unshift(meta);
      cur = cur.basedOn ? this.versions.get(cur.basedOn) : undefined;
    }
    return chain;
  }
}
