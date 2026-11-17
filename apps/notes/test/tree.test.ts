import { expect, test } from "bun:test";
import { canDrop, remap } from "../tree";

test("a drop must change something and never put a folder inside itself", () => {
  expect(canDrop("/Notes/a.md", "/Notes/Ideas")).toBe(true);
  expect(canDrop("/Notes/a.md", "/Notes")).toBe(false); // already there
  expect(canDrop("/Notes/Ideas", "/Notes/Ideas")).toBe(false);
  expect(canDrop("/Notes/Ideas", "/Notes/Ideas/Deep")).toBe(false);
  expect(canDrop("/Notes/Ideas/a.md", "/Notes")).toBe(true); // out to the root
  expect(canDrop("/Notes/Ideas", "/Notes/Ideas2")).toBe(true); // a longer name is not inside it
});

test("remap follows a moved file or folder", () => {
  expect(remap("/N/a.md", "/N/a.md", "/N/X/a.md")).toBe("/N/X/a.md");
  expect(remap("/N/D/a.md", "/N/D", "/N/X/D")).toBe("/N/X/D/a.md");
  expect(remap("/N/D2/a.md", "/N/D", "/N/X/D")).toBe("/N/D2/a.md");
});
