import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testHost, type TestHost } from "../../host/src/testing";

let h: TestHost;
let dir: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "brasos-docs-"));
  writeFileSync(join(dir, "02-second.md"), "# Second page\n\nSee [the first](01-first.md#top) and [GitHub](https://github.com/x/y).\n\n| a | b |\n|---|---|\n| 1 | 2 |\n");
  writeFileSync(join(dir, "01-first.md"), "# First page\n\nHello **world**.\n");
  writeFileSync(join(dir, "notes.txt"), "not a doc");
  h = await testHost({ docsDir: dir });
});
afterAll(() => (h.stop(), rmSync(dir, { recursive: true, force: true })));

const docs = (path: string, from = "docs.localhost") => h.at("localhost", `/os/docs${path}`, { headers: { origin: h.origin(from) } });

test("pages are listed in file-name order with titles from their first heading", async () => {
  expect(await (await docs("")).json()).toEqual([{ slug: "first", title: "First page" }, { slug: "second", title: "Second page" }]);
});

test("a page renders markdown to HTML", async () => {
  const p = await (await docs("/first")).json();
  expect(p).toMatchObject({ slug: "first", title: "First page" });
  expect(p.html).toContain("<strong>world</strong>");
});

test("links: other pages become anchors, web links are shown as text, tables render", async () => {
  const { html } = await (await docs("/second")).json();
  expect(html).toContain('<a href="#first"');
  expect(html).toContain('<span class="ext" title="https://github.com/x/y">GitHub</span>');
  expect(html).not.toContain('href="https://github.com');
  expect(html).toContain("<table>");
});

test("a slug is never a path", async () => {
  for (const s of ["../package", "..%2Fpackage", "notes", "%2e%2e", "FIRST", "nope"]) expect((await docs("/" + s)).status).toBe(404);
});

test("only apps with docs.read may read; others and anonymous callers are refused", async () => {
  expect((await docs("", "about.localhost")).status).toBe(403);
  expect((await h.at("localhost", "/os/docs")).status).toBe(403);
});

test("the real guides render (every page has content and no leftover web links)", async () => {
  const real = await testHost();
  const get = (p: string) => real.at("localhost", p, { headers: { origin: real.origin("docs.localhost") } });
  try {
    for (const p of await (await get("/os/docs")).json()) {
      const page = await (await get(`/os/docs/${p.slug}`)).json();
      expect(page.html.length).toBeGreaterThan(0);
      expect(page.html).not.toMatch(/<a href="https?:/);
    }
  } finally {
    real.stop();
  }
});
