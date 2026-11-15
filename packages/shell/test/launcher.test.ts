import { expect, test } from "bun:test";
import { search, type Hit } from "../src/launcher";

const hit = (kind: Hit["kind"], label: string, meta?: string): Hit => ({ key: kind + label, kind, icon: "app", label, meta, run() {} });
const all = [hit("File", "docs-notes.txt", "/Documents"), hit("App", "Docs"), hit("App", "Files"), hit("Window", "Docs"), hit("Guide", "Using BrasOS", "Guide")];

test("no query lists the apps only (the start menu)", () => {
  expect(search(all, "").map((h) => h.label)).toEqual(["Docs", "Files"]);
  expect(search(all, "   ").map((h) => h.kind)).toEqual(["App", "App"]);
});

test("a query matches every word, case-insensitively, apps first", () => {
  expect(search(all, "DOCS").map((h) => h.kind)).toEqual(["App", "Window", "File"]);
  expect(search(all, "using bras").map((h) => h.label)).toEqual(["Using BrasOS"]);
  expect(search(all, "zzz")).toEqual([]);
});

test("the path of a file is searchable too", () => {
  expect(search(all, "documents").map((h) => h.label)).toEqual(["docs-notes.txt"]);
});
