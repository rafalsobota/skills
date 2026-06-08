import type { BridgeLike, Comment, ViewerOutbound } from "../src/types";

export class FakeBridge implements BridgeLike {
  onFlush: (comments: Comment[]) => void = () => {};
  onRequestShow: (id: string) => void = () => {};
  onHello: () => void = () => {};
  sent: ViewerOutbound[] = [];

  broadcast(msg: ViewerOutbound): void {
    this.sent.push(msg);
  }
}
