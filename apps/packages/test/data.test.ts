import { expect, test } from "bun:test";
import { BY_ID, CATALOG, plan, requiredBy } from "../data";

test("every dependency in the catalog exists", () => {
  for (const p of CATALOG) for (const d of p.deps) expect(BY_ID.has(d)).toBe(true);
});

test("an install lists what is missing, dependencies first, and skips what is installed", () => {
  const have = new Set(["glibc", "zlib"]);
  const ids = plan("libpng", have).map((p) => p.id);
  expect(ids).toEqual(["libpng"]);
  const gimp = plan("gimp", have).map((p) => p.id);
  expect(gimp[gimp.length - 1]).toBe("gimp");
  expect(gimp.indexOf("mesa")).toBeLessThan(gimp.indexOf("gtk4")); // a package comes after what it needs
  expect(plan("gimp", new Set(CATALOG.map((p) => p.id)))).toEqual([]);
});

test("a package that something installed needs can't be removed", () => {
  const have = new Set(["glibc", "zlib", "libpng", "gtk4", "mesa", "libdrm"]);
  expect(requiredBy("libpng", have).map((p) => p.id)).toEqual(["gtk4"]);
  expect(requiredBy("gtk4", have)).toEqual([]);
});
