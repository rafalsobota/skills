// src/server.ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { VersionStore } from "./version-store";
import { FeedbackBuffer } from "./feedback-buffer";
import { UnixSocketBridge } from "./unix-bridge";
import { resolveLauncherPath } from "./launcher-path";
import { DiagramService } from "./diagram-service";
import { buildMcpServer } from "./mcp-server";

// WAŻNE: logi WYŁĄCZNIE na stderr — stdout należy do JSON-RPC.
const log = (...a: unknown[]) => console.error("[sedno]", ...a);

async function main() {
  const store = new VersionStore();
  const buffer = new FeedbackBuffer();

  const launcherPath = resolveLauncherPath();
  if (launcherPath === null) {
    log("viewer app not built — run `bun run build:viewer`; rendering will be windowless until then");
  }

  const bridge = new UnixSocketBridge({ launcherPath });
  await bridge.start();
  log("viewer socket at", bridge.sockPath);

  const service = new DiagramService(store, buffer, bridge, {
    onFirstRender: () => bridge.ensureViewer(),
  });

  const server = buildMcpServer(service);

  let shuttingDown = false;
  const shutdown = (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("shutting down:", sig);
    bridge.stop(); // kills the window child + unlinks the socket
    process.exit(0);
  };

  const transport = new StdioServerTransport();
  transport.onclose = () => shutdown("transport-closed");
  await server.connect(transport);
  log("MCP server connected over stdio");

  // Pod Bun transport.onclose nie odpala się niezawodnie na EOF stdin — nasłuchujemy jawnie.
  // Listenery 'end'/'close' są pasywne (nie konsumują bajtów), więc nie kolidują z transportem.
  process.stdin.on("end", () => shutdown("stdin-end"));
  process.stdin.on("close", () => shutdown("stdin-close"));

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((e) => {
  console.error("[sedno] fatal:", e);
  process.exit(1);
});
