import { test, expect, describe, beforeEach } from "bun:test";
import { VersionStore } from "../src/version-store";
import { FeedbackBuffer } from "../src/feedback-buffer";
import { DiagramService } from "../src/diagram-service";
import { FakeBridge } from "./fake-bridge";

function setup(opts?: { onFirstRender?: () => void }) {
  const store = new VersionStore();
  const buffer = new FeedbackBuffer();
  const bridge = new FakeBridge();
  const service = new DiagramService(store, buffer, bridge, opts);
  return { store, buffer, bridge, service };
}

describe("DiagramService", () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => { s = setup(); });

  test("render dodaje wersję i nadaje render z historią", () => {
    const v = s.service.render({ svg: "<svg>A</svg>", title: "A" });
    expect(v.id).toBe("v1");
    expect(s.store.current?.svg).toBe("<svg>A</svg>");
    const msg = s.bridge.sent.at(-1)!;
    expect(msg.type).toBe("render");
    if (msg.type === "render") {
      expect(msg.version.id).toBe("v1");
      expect(msg.svg).toBe("<svg>A</svg>");
      expect(msg.history.map((h) => h.id)).toEqual(["v1"]);
    }
  });

  test("onFirstRender wywoływane tylko raz", () => {
    let calls = 0;
    const s2 = setup({ onFirstRender: () => { calls++; } });
    s2.service.render({ svg: "<svg/>" });
    s2.service.render({ svg: "<svg/>" });
    expect(calls).toBe(1);
  });

  test("showVersion ustawia current i nadaje show", () => {
    s.service.render({ svg: "<svg>A</svg>" });
    s.service.render({ svg: "<svg>B</svg>" });
    const v = s.service.showVersion("v1");
    expect(v.id).toBe("v1");
    expect(s.store.current?.id).toBe("v1");
    const msg = s.bridge.sent.at(-1)!;
    expect(msg.type).toBe("show");
    if (msg.type === "show") expect(msg.svg).toBe("<svg>A</svg>");
  });

  test("showVersion rzuca dla nieznanego id", () => {
    expect(() => s.service.showVersion("v9")).toThrow("unknown version: v9");
  });

  test("bridge.onFlush wpisuje komentarze do bufora; getFeedback drenuje", () => {
    s.service.render({ svg: "<svg/>" });
    s.bridge.onFlush([{ versionId: "v1", target: { kind: "global" }, text: "uwaga" }]);
    expect(s.service.peekFeedback().map((c) => c.text)).toEqual(["uwaga"]);
    expect(s.service.getFeedback().map((c) => c.text)).toEqual(["uwaga"]);
    expect(s.service.getFeedback()).toEqual([]);
  });

  test("bridge.onRequestShow przełącza wersję (i ignoruje nieznane id)", () => {
    s.service.render({ svg: "<svg>A</svg>" });
    s.service.render({ svg: "<svg>B</svg>" });
    s.bridge.onRequestShow("v1");
    expect(s.store.current?.id).toBe("v1");
    s.bridge.onRequestShow("v999"); // nie rzuca
    expect(s.store.current?.id).toBe("v1");
  });

  test("bridge.onHello ponownie nadaje bieżącą wersję", () => {
    s.service.render({ svg: "<svg>A</svg>" });
    s.bridge.sent.length = 0;
    s.bridge.onHello();
    const msg = s.bridge.sent.at(-1)!;
    expect(msg.type).toBe("render");
    if (msg.type === "render") expect(msg.version.id).toBe("v1");
  });
});
