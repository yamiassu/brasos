import { expect, test } from "bun:test";
import { baseName, formatSize, imageMime, isImage, isText, join, parent, startFromHash, validName } from "../paths";

test("join, parent and baseName treat / as the root", () => {
  expect(join("/", "a")).toBe("/a");
  expect(join("/Documents", "a.txt")).toBe("/Documents/a.txt");
  expect(parent("/Documents/a.txt")).toBe("/Documents");
  expect(parent("/Documents")).toBe("/");
  expect(parent("/")).toBe("/");
  expect(baseName("/Documents/a.txt")).toBe("a.txt");
  expect(baseName("/")).toBe("");
});

test("a name is one segment", () => {
  for (const ok of ["a", "notes.txt", "my folder", ".hidden"]) expect(validName(ok)).toBe(true);
  for (const bad of ["", "  ", ".", "..", "a/b", "a\\b", "x\0y"]) expect(validName(bad)).toBe(false);
});

test("sizes are human readable", () => {
  expect(formatSize(0)).toBe("0 B");
  expect(formatSize(1023)).toBe("1023 B");
  expect(formatSize(1536)).toBe("1.5 KB");
  expect(formatSize(20 * 1024)).toBe("20 KB");
  expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB");
});

test("file kinds", () => {
  expect(isText("a.MD")).toBe(true);
  expect(isText("a.png")).toBe(false);
  expect(isImage("a.JPG")).toBe(true);
  expect(imageMime("x.jpeg")).toBe("image/jpeg");
});

test("a window hash picks the folder to show and the file to select", () => {
  expect(startFromHash("")).toEqual({ dir: "/" });
  expect(startFromHash("#/Desktop")).toEqual({ dir: "/Desktop" });
  expect(startFromHash("#/Desktop/")).toEqual({ dir: "/Desktop" });
  expect(startFromHash("#/Desktop/notes.txt")).toEqual({ dir: "/Desktop", select: "notes.txt" });
  expect(startFromHash("#/My%20Docs/a.md")).toEqual({ dir: "/My Docs", select: "a.md" });
  expect(startFromHash("#/%E0%A4%A")).toEqual({ dir: "/" }); // malformed escape: don't throw, start at the root
});
