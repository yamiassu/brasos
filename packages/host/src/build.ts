import { join } from "node:path";

/** Bundles the shell, the given apps and the standalone SDK into `dist`. At image build time (Nix) this runs once; the running server never builds. */
export async function build(o: { root: string; dist: string; appIds: string[] }) {
  const pages = await Bun.build({
    entrypoints: [join(o.root, "packages/shell/src/index.html"), ...o.appIds.map((id) => join(o.root, "apps", id, "index.html"))],
    outdir: o.dist,
    root: o.root,
  });
  // served at /__brasos/sdk.js on every origin, and injected into websites by the gateway
  const sdk = await Bun.build({
    entrypoints: [join(o.root, "packages/sdk/src/bootstrap.ts")],
    outdir: join(o.dist, "__brasos"),
    naming: "sdk.js",
    format: "iife",
    target: "browser",
    minify: true,
  });
  for (const r of [pages, sdk]) if (!r.success) throw new Error(r.logs.join("\n"));
}
