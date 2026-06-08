import { test, expect, describe, beforeEach } from "bun:test";
import { VersionStore } from "../src/version-store";

describe("VersionStore", () => {
  let store: VersionStore;
  beforeEach(() => { store = new VersionStore(); });

  test("nadaje sekwencyjne id v1, v2", () => {
    expect(store.add("<svg/>").id).toBe("v1");
    expect(store.add("<svg/>").id).toBe("v2");
  });

  test("get zwraca wersję; undefined dla brakującej", () => {
    const v = store.add("<svg id='a'/>", { title: "pierwsza" });
    expect(store.get("v1")).toEqual(v);
    expect(store.get("nope")).toBeUndefined();
  });

  test("current wskazuje ostatnio dodaną", () => {
    store.add("<svg/>");
    store.add("<svg/>");
    expect(store.current?.id).toBe("v2");
  });

  test("setCurrent zmienia wskaźnik; rzuca dla nieznanego id", () => {
    store.add("<svg/>");
    store.add("<svg/>");
    store.setCurrent("v1");
    expect(store.current?.id).toBe("v1");
    expect(() => store.setCurrent("v99")).toThrow("unknown version: v99");
  });

  test("history zwraca metadane (bez svg) w kolejności dodania", () => {
    store.add("<svg>A</svg>", { title: "A" });
    store.add("<svg>B</svg>", { basedOn: "v1" });
    const h = store.history();
    expect(h.map((v) => v.id)).toEqual(["v1", "v2"]);
    expect(h[1]).toEqual({ id: "v2", title: undefined, basedOn: "v1", createdAt: h[1]!.createdAt });
    expect((h[0] as any).svg).toBeUndefined();
  });

  test("lineage zwraca łańcuch root -> liść po basedOn", () => {
    store.add("<svg/>");
    store.add("<svg/>", { basedOn: "v1" });
    store.add("<svg/>", { basedOn: "v2" });
    expect(store.lineage("v3").map((v) => v.id)).toEqual(["v1", "v2", "v3"]);
  });
});
