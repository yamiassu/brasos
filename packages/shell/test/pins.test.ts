import { expect, test } from "bun:test";
import { isPinned, setPinned, type Unpinned } from "../src/pins";

test("everything is pinned until it is unpinned, per place", () => {
  let u: Unpinned = { taskbar: [], start: [] };
  expect(isPinned(u, "taskbar", "files")).toBe(true);
  u = setPinned(u, "taskbar", "files", false);
  expect(isPinned(u, "taskbar", "files")).toBe(false);
  expect(isPinned(u, "start", "files")).toBe(true); // the other place is untouched
  u = setPinned(setPinned(u, "taskbar", "files", false), "taskbar", "files", false);
  expect(u.taskbar).toEqual(["files"]); // no duplicates
  expect(isPinned(setPinned(u, "taskbar", "files", true), "taskbar", "files")).toBe(true);
});
