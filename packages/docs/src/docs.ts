// Docs: the OS's own documentation, served from markdown files (docs/guide/*.md) rendered with Bun's built-in
// CommonMark renderer. Pages are ordered by file name (01-welcome.md, 02-...); the title is the first `# ` heading.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { json, type Slice } from "@brasos/host/types";

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const MAX_PAGE = 512 * 1024;

export type DocPage = { slug: string; title: string };

export function createDocs(o: { dir: string }) {
  const slugOf = (file: string) => file.replace(/^\d+-/, "").replace(/\.md$/, "");
  const files = () => (existsSync(o.dir) ? readdirSync(o.dir).filter((f) => f.endsWith(".md")).sort() : []);
  const read = (file: string) => readFileSync(join(o.dir, file), "utf8").slice(0, MAX_PAGE);
  const titleOf = (md: string, fallback: string) => md.match(/^#\s+(.+)$/m)?.[1].trim() ?? fallback;

  const list = (): DocPage[] => files().map((f) => ({ slug: slugOf(f), title: titleOf(read(f), slugOf(f)) }));

  function page(slug: string) {
    if (!SLUG.test(slug)) return null; // a slug is never a path: no way to reach a file outside the folder
    const file = files().find((f) => slugOf(f) === slug);
    if (!file) return null;
    const md = read(file);
    // The docs are our own content, but links stay safe anyway: http(s) links are shown as text (a page loaded inside
    // an app window would otherwise navigate away from the OS), and links between pages become #slug anchors.
    const html = (Bun.markdown.html(md) as string)
      .replace(/<a href="https?:\/\/([^"]*)"[^>]*>(.*?)<\/a>/g, '<span class="ext" title="https://$1">$2</span>')
      .replace(/<a href="(?:\.\/)?(?:\d+-)?([a-z0-9-]+)\.md(?:#[^"]*)?"/g, '<a href="#$1"');
    return { slug, title: titleOf(md, slug), html };
  }

  const slice: Slice = {
    name: "docs",
    handle(req, ctx) {
      if (ctx.target.kind !== "shell" || req.method !== "GET" || !ctx.url.pathname.startsWith("/os/docs")) return;
      const g = ctx.gate("docs.read", { quiet: true });
      if (!g.ok) return g.res;
      if (ctx.url.pathname === "/os/docs") return json(list());
      const p = page(ctx.url.pathname.slice("/os/docs/".length));
      return p ? json(p) : json({ error: "no such page" }, 404);
    },
  };
  return { slice, list, page };
}

export type Docs = ReturnType<typeof createDocs>;
