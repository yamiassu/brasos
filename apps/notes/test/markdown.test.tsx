import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../markdown";

const html = (t: string) => renderToStaticMarkup(<Markdown text={t} />);

test("renders the common blocks and inline marks", () => {
  expect(html("# Hi\n\nsome **bold** and *it* and `c`")).toBe("<h1>Hi</h1><p>some <strong>bold</strong> and <em>it</em> and <code>c</code></p>");
  expect(html("- a\n- b\n\n1. x")).toBe("<ul><li>a</li><li>b</li></ul><ol><li>x</li></ol>");
  expect(html("```\n<b>\n```")).toBe("<pre><code>&lt;b&gt;</code></pre>");
  expect(html("> quote")).toBe("<blockquote><p>quote</p></blockquote>");
});

test("never emits raw html or javascript links", () => {
  expect(html("<script>x</script>")).not.toContain("<script>");
  expect(html("[x](javascript:alert(1))")).not.toContain("javascript:");
  expect(html("[x](https://a.b)")).toContain('href="https://a.b"');
});

import { splitBlocks } from "../markdown";
test("splits blocks on blank lines but not inside fences", () => {
  expect(splitBlocks("# a\n\n\nb\nc\n\n```\nx\n\ny\n```")).toEqual(["# a", "b\nc", "```\nx\n\ny\n```"]);
  expect(splitBlocks("")).toEqual([""]);
});
