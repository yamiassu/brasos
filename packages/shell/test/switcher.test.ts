import { expect, test } from "bun:test";
import { isSwitchKey, stepIndex, switchItems } from "../src/switcher-model";

const w = (key: number, z: number, min = false) => ({ key, z, title: `W${key}`, icon: "app", min });

test("the window in front is first, then the rest, most recently used first", () => {
  expect(switchItems([w(1, 3), w(2, 9), w(3, 5)], [], "pwa").map((i) => i.id)).toEqual(["w:2", "w:3", "w:1"]);
});

test("a minimized window is listed but never counts as the one in front", () => {
  const items = switchItems([w(1, 3), w(2, 9, true), w(3, 5)], [], "pwa");
  expect(items.map((i) => i.id)).toEqual(["w:3", "w:2", "w:1"]); // 3 has the focus; the minimized 2 is next in recency
  expect(items.find((i) => i.ref === 2)!.minimized).toBe(true);
});

test("native windows follow the BrasOS ones, unless one of them has the focus", () => {
  const natives = [{ id: 7, title: "Steam", focused: false }, { id: 8, title: "Browser", focused: true }];
  expect(switchItems([w(1, 3)], natives, "pwa").map((i) => i.id)).toEqual(["w:1", "n:7", "n:8"]);
  expect(switchItems([w(1, 3)], natives, "native").map((i) => i.id)).toEqual(["n:8", "w:1", "n:7"]);
  expect(switchItems([], [], "pwa")).toEqual([]);
});

test("Tab moves forward, Shift+Tab back, and both wrap around", () => {
  expect(stepIndex(0, 3, 1)).toBe(1);
  expect(stepIndex(2, 3, 1)).toBe(0);
  expect(stepIndex(0, 3, -1)).toBe(2);
  expect(stepIndex(0, 0, 1)).toBe(0);
});

test("only Alt+Tab starts the switcher", () => {
  expect(isSwitchKey({ key: "Tab", altKey: true })).toBe(true);
  expect(isSwitchKey({ key: "Tab", altKey: true, ctrlKey: true })).toBe(false);
  expect(isSwitchKey({ key: "Tab", altKey: true, metaKey: true })).toBe(false);
  expect(isSwitchKey({ key: "Tab" })).toBe(false);
  expect(isSwitchKey({ key: "a", altKey: true })).toBe(false);
});
