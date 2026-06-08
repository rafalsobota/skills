import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DiagramService } from "./diagram-service";

const RENDER_DESCRIPTION =
  "Render an SVG diagram into the user's live window as a new version. " +
  "Put a STABLE `data-node-id` attribute on each node element and a STABLE " +
  "`data-edge-id` on each edge/connector so the user can click them to comment. " +
  "Returns the new version id (v1, v2, ...). Non-blocking: the diagram appears " +
  "immediately and you keep talking. To collect the user's comments, call " +
  "get_feedback (e.g. after the user says 'zobacz teraz'). To build on an earlier " +
  "version, pass its id as basedOn.";

type TextResult = {
  content: { type: "text"; text: string }[];
  isError?: true;
};

// --- czyste handlery (testowalne bez transportu) ---

export function handleRenderDiagram(
  service: DiagramService,
  args: { svg: string; title?: string; basedOn?: string },
): TextResult {
  const v = service.render({ svg: args.svg, title: args.title, basedOn: args.basedOn });
  return { content: [{ type: "text", text: `Rendered ${v.id}${v.title ? ` (${v.title})` : ""}.` }] };
}

export function handleShowVersion(service: DiagramService, args: { id: string }): TextResult {
  try {
    const v = service.showVersion(args.id);
    return { content: [{ type: "text", text: `Showing ${v.id}.` }] };
  } catch {
    return { content: [{ type: "text", text: `Unknown version: ${args.id}.` }], isError: true };
  }
}

export function handleGetFeedback(service: DiagramService): TextResult {
  const comments = service.getFeedback();
  if (comments.length === 0) {
    return { content: [{ type: "text", text: "No pending feedback." }] };
  }
  return { content: [{ type: "text", text: JSON.stringify(comments, null, 2) }] };
}

// --- rejestracja w McpServer (cienkie wiązanie + powiadomienia o zasobach) ---

export function buildMcpServer(service: DiagramService): McpServer {
  const server = new McpServer(
    { name: "sedno", version: "0.1.0" },
    {
      capabilities: {
        tools: { listChanged: true },
        resources: { subscribe: true, listChanged: true },
      },
    },
  );

  server.registerTool(
    "render_diagram",
    {
      title: "Render diagram",
      description: RENDER_DESCRIPTION,
      inputSchema: {
        svg: z.string().describe("Complete <svg>...</svg> markup."),
        title: z.string().optional().describe("Short label for this version."),
        basedOn: z.string().optional().describe("Version id this builds on, e.g. 'v3'."),
      },
    },
    async (args) => {
      const out = handleRenderDiagram(service, args);
      server.sendResourceListChanged();
      await server.server.sendResourceUpdated({ uri: "diagram://current" });
      return out;
    },
  );

  server.registerTool(
    "show_version",
    {
      title: "Show version",
      description:
        "Switch the window to display an existing diagram version by id (e.g. 'v3') without regenerating it.",
      inputSchema: { id: z.string().describe("Version id, e.g. 'v3'.") },
    },
    async (args) => {
      const out = handleShowVersion(service, args);
      if (!out.isError) await server.server.sendResourceUpdated({ uri: "diagram://current" });
      return out;
    },
  );

  server.registerTool(
    "get_feedback",
    {
      title: "Get feedback",
      description:
        "Return and clear the user's pending diagram comments (call after the user signals they are ready, e.g. 'zobacz teraz').",
      inputSchema: {},
    },
    async () => {
      const out = handleGetFeedback(service);
      await server.server.sendResourceUpdated({ uri: "diagram://pending" });
      return out;
    },
  );

  server.registerResource(
    "current",
    "diagram://current",
    { title: "Current diagram", mimeType: "image/svg+xml" },
    async (uri) => {
      const v = service.currentVersion();
      return { contents: [{ uri: uri.href, mimeType: "image/svg+xml", text: v?.svg ?? "" }] };
    },
  );

  server.registerResource(
    "history",
    "diagram://history",
    { title: "Version history", mimeType: "application/json" },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(service.history(), null, 2) }],
    }),
  );

  server.registerResource(
    "pending",
    "diagram://pending",
    { title: "Pending feedback", mimeType: "application/json" },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(service.peekFeedback(), null, 2) }],
    }),
  );

  server.registerResource(
    "version",
    new ResourceTemplate("diagram://version/{id}", { list: undefined }),
    { title: "Diagram version", mimeType: "image/svg+xml" },
    async (uri, { id }) => {
      const v = service.getVersion(String(id));
      return { contents: [{ uri: uri.href, mimeType: "image/svg+xml", text: v?.svg ?? "" }] };
    },
  );

  return server;
}
