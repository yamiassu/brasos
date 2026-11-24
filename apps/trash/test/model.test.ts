import { expect, test } from "bun:test";
import { matches, originalFolder, originalName, when } from "../model";

const e = (name: string, from: string | null) => ({ name, from, kind: "file" as const, size: 1, mtime: 0, deleted: 0 });

test("the original name and folder come from where it was deleted, or from its trash name", () => {
  expect(originalName(e("1700000000000-notes.txt", "/Desktop/notes.txt"))).toBe("notes.txt");
  expect(originalName(e("1700000000000-a-b.txt", null))).toBe("a-b.txt"); // only the time prefix is dropped
  expect(originalFolder(e("x", "/Documents/sub/f"))).toBe("/Documents/sub");
  expect(originalFolder(e("x", "/f"))).toBe("Home");
  expect(originalFolder(e("x", null))).toBe("Unknown");
});

test("search looks at the name and the folder, ignoring case", () => {
  const x = e("1-Report.pdf", "/Documents/Work/Report.pdf");
  expect(matches(x, "")).toBe(true);
  expect(matches(x, "report")).toBe(true);
  expect(matches(x, "work")).toBe(true);
  expect(matches(x, "desktop")).toBe(false);
});

test("dates read as today, yesterday or a date", () => {
  const now = new Date(2026, 10, 24, 15, 0).getTime();
  expect(when(new Date(2026, 10, 24, 9, 5).getTime(), now)).toStartWith("Today");
  expect(when(new Date(2026, 10, 23, 23, 59).getTime(), now)).toStartWith("Yesterday");
  expect(when(new Date(2026, 9, 1).getTime(), now)).not.toMatch(/Today|Yesterday/);
});
