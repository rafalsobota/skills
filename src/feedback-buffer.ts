import type { Comment } from "./types";

export class FeedbackBuffer {
  private items: Comment[] = [];

  push(comment: Comment): void {
    this.items.push(comment);
  }

  peek(): readonly Comment[] {
    return [...this.items];
  }

  drain(): Comment[] {
    const out = this.items;
    this.items = [];
    return out;
  }

  get size(): number {
    return this.items.length;
  }
}
