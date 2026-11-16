import { expect, test } from "bun:test";
import { atTopEdge, restoreLeft } from "../src/windows";

test("dragging a maximized window keeps the pointer at the same relative place on the title bar", () => {
  expect(restoreLeft(500, 1000, 400)).toBe(300); // halfway across stays halfway: the pointer is 200 into a 400 wide window
  expect(restoreLeft(250, 1000, 400)).toBe(150); // a quarter of the way
});

test("the restored window never leaves the screen", () => {
  expect(restoreLeft(0, 1000, 400)).toBe(0);
  expect(restoreLeft(1000, 1000, 400)).toBe(600); // the right edge lines up with the screen's
  expect(restoreLeft(10, 300, 640)).toBe(0); // wider than the screen: pinned to the left
  expect(restoreLeft(5, 0, 640)).toBe(0);
});

test("only the very top edge of the page snaps a dragged window", () => {
  expect(atTopEdge(0)).toBe(true);
  expect(atTopEdge(-5)).toBe(true); // a pointer captured above the page
  expect(atTopEdge(2)).toBe(true);
  expect(atTopEdge(3)).toBe(false);
  expect(atTopEdge(40)).toBe(false);
});
