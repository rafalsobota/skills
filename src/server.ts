import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { VersionStore } from "./version-store";
import { FeedbackBuffer } from "./feedback-buffer";
import { ViewerBridge } from "./viewer-bridge";
import { DiagramService } from "./diagram-service";
import { buildMcpServer } from "./mcp-server";

// WAŻNE: logi WYŁĄCZNIE na stderr — stdout należy do JSON-RPC.
const log = (...a: unknown[]) => console.error("[sedno]", ...a);

async function main() {
  const store = new VersionStore();
  const buffer = new FeedbackBuffer();
  const bridge = new ViewerBridge();
  await bridge.start();
  log("viewer serving at", bridge.url);

  const service = new DiagramService(store, buffer, bridge, {
    onFirstRender: () => {
      log("opening viewer:", bridge.url);
      Bun.spawn(["open", bridge.url], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    },
  });

  const server = buildMcpServer(service);

  let shuttingDown = false;
  const shutdown = (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("shutting down:", sig);
    bridge.stop();
    process.exit(0);
  };

  const transport = new StdioServerTransport();
  transport.onclose = () => shutdown("stdin-closed"); // Claude Code zamknął nasze stdin
  await server.connect(transport);
  log("MCP server connected over stdio");

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((e) => {
  console.error("[sedno] fatal:", e);
  process.exit(1);
});
