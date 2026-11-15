# docs

The OS's own documentation, served from markdown.

- **Source:** `docs/guide/NN-name.md`, ordered by file name; the title is the first `# ` heading; the slug is the name without its number (`04-building-apps.md` is `building-apps`).
- **Routes:** `GET /os/docs` (the list) and `GET /os/docs/<slug>` (`{ slug, title, html }`), capability `docs.read`, held by the Docs app. Rendering uses Bun's built-in CommonMark renderer, so there is no dependency.
- **Links:** links between guides become `#slug` anchors; web links are shown as text (a link clicked inside an app window would navigate away from the OS).
- **A slug is never a path:** only `[a-z0-9-]` slugs resolve, and only to files in the guide folder.
- **Hardened:** the Docs app opts in and `docs.read` stays on, so the guides ship in the hardened image.

Tests: `test/docs.test.ts` (rendering, links, slug safety, permissions, the real guides, and that every cross-link between guides resolves). Benchmarks: `bench.ts`.
