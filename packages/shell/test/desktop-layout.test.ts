import { expect, test } from "bun:test";
import { arrange, cellAt, nearestFree, pixel, rowsFor } from "../src/desktop-layout";

test("icons without a saved cell flow top to bottom, then to the next column", () => {
  expect(arrange(["a", "b", "c"], {}, 2)).toEqual({ a: { col: 0, row: 0 }, b: { col: 0, row: 1 }, c: { col: 1, row: 0 } });
});

test("a saved cell is kept, and the others flow around it", () => {
  const out = arrange(["a", "b", "c"], { b: { col: 0, row: 0 } }, 2);
  expect(out.b).toEqual({ col: 0, row: 0 });
  expect(out.a).toEqual({ col: 0, row: 1 });
  expect(out.c).toEqual({ col: 1, row: 0 });
});

test("a saved cell below the visible rows, or already taken, is treated as unsaved", () => {
  const out = arrange(["a", "b"], { a: { col: 0, row: 9 }, b: { col: 0, row: 9 } }, 2);
  expect(out).toEqual({ a: { col: 0, row: 0 }, b: { col: 0, row: 1 } });
  const dup = arrange(["a", "b"], { a: { col: 1, row: 0 }, b: { col: 1, row: 0 } }, 3);
  expect(dup.a).toEqual({ col: 1, row: 0 });
  expect(dup.b).not.toEqual({ col: 1, row: 0 });
});

test("dropping on a taken cell lands on the nearest free one", () => {
  expect(nearestFree({ col: 0, row: 0 }, [], 3)).toEqual({ col: 0, row: 0 });
  const c = nearestFree({ col: 0, row: 0 }, [{ col: 0, row: 0 }], 3);
  expect(c).not.toEqual({ col: 0, row: 0 });
  expect(Math.max(c.col, c.row)).toBe(1);
});

test("pixels and cells convert both ways, clamped to the grid", () => {
  const p = pixel({ col: 2, row: 1 });
  expect(cellAt(p.left + 10, p.top + 10, 5, 5)).toEqual({ col: 2, row: 1 });
  expect(cellAt(-50, 9999, 5, 5)).toEqual({ col: 0, row: 4 });
  expect(rowsFor(0)).toBe(1);
  expect(rowsFor(600)).toBe(5);
});
