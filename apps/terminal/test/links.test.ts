import { expect, test } from "bun:test";
import { urlAt, urlOf } from "../links";

test("finds the address under a column and leaves sentence punctuation out", () => {
  const line = "see https://example.com/a?b=1, and http://x.dev.";
  expect(urlAt(line, 0)).toBeNull();
  expect(urlAt(line, 10)).toBe("https://example.com/a?b=1");
  expect(urlAt(line, 29)).toBeNull(); // the comma
  expect(urlAt(line, 38)).toBe("http://x.dev");
});

test("a selection counts only when it is a single address", () => {
  expect(urlOf("  https://a.b/c ")).toBe("https://a.b/c");
  expect(urlOf("ls https://a.b")).toBeNull();
  expect(urlOf("javascript:alert(1)")).toBeNull();
});
