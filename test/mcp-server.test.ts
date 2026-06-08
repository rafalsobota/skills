import { test, expect, describe, beforeEach } from "bun:test";
import { VersionStore } from "../src/version-store";
import { FeedbackBuffer } from "../src/feedback-buffer";
import { DiagramService } from "../src/diagram-service";
import { FakeBridge } from "./fake-bridge";
import {
  handleRenderDiagram,
  handleShowVersion,
  handleGetFeedback,
  buildMcpServer,
} from "../src/mcp-server";

function service() {
  const bridge = new FakeBridge();
  const svc = new DiagramService(new VersionStore(), new FeedbackBuffer(), bridge);
  return { svc, bridge };
}

describe("MCP handlers", () => {
  let s: ReturnType<typeof service>;
  beforeEach(() => { s = service(); });

  test("handleRenderDiagram renderuje i zwraca id w tekście", () => {
    const out = handleRenderDiagram(s.svc, { svg: "<svg>A</svg>", title: "A" });
    expect(out.content[0]!.text).toContain("v1");
    expect(s.svc.currentVersion()?.svg).toBe("<svg>A</svg>");
  });

  test("handleShowVersion dla nieznanego id zwraca isError", () => {
    const out = handleShowVersion(s.svc, { id: "v9" });
    expect(out.isError).toBe(true);
    expect(out.content[0]!.text).toContain("v9");
  });

  test("handleShowVersion przełącza istniejącą wersję", () => {
    s.svc.render({ svg: "<svg>A</svg>" });
    s.svc.render({ svg: "<svg>B</svg>" });
    const out = handleShowVersion(s.svc, { id: "v1" });
    expect(out.isError).toBeUndefined();
    expect(s.svc.currentVersion()?.id).toBe("v1");
  });

  test("handleGetFeedback: pusto, potem JSON komentarzy, potem znów pusto", () => {
    expect(handleGetFeedback(s.svc).content[0]!.text).toBe("No pending feedback.");
    s.svc.render({ svg: "<svg/>" });
    s.bridge.onFlush([{ versionId: "v1", target: { kind: "global" }, text: "uwaga" }]);
    expect(handleGetFeedback(s.svc).content[0]!.text).toContain("uwaga");
    expect(handleGetFeedback(s.svc).content[0]!.text).toBe("No pending feedback.");
  });

  test("buildMcpServer konstruuje się bez wyjątku", () => {
    const server = buildMcpServer(s.svc);
    expect(server).toBeTruthy();
  });
});
