// test/launcher-path.test.ts
import { expect, test } from "bun:test";
import { resolveLauncherPath } from "../src/launcher-path";

test("returns null when the viewer is not built", () => {
  expect(resolveLauncherPath("/definitely/not/a/repo")).toBeNull();
});
