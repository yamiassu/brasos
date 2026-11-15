// App registry: the list of things you can open. Built-in apps and installed PWAs are both described by a Web App
// Manifest, so "an app" is just a PWA plus an optional `brasos` block (icon, permissions, hardened opt-in).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { json, type Manifest, type Slice } from "@brasos/host/types";
import type { AppInfo } from "@brasos/sdk";

export type RegistryOptions = {
  appsDir: string;
  /** where installed PWAs are kept; without it nothing can be installed */
  stateDir?: string;
  /** policies from enabled packages (all must allow) */
  allowApp?: (m: Manifest) => boolean;
  /** SSRF-safe manifest fetch, injected by the host; absent when installing is not available */
  fetchManifest?: (url: URL) => Promise<unknown>;
};

export function createRegistry(o: RegistryOptions) {
  const allow = o.allowApp ?? (() => true);
  const pwaDir = o.stateDir && join(o.stateDir, "apps");

  const builtinIds = () =>
    readdirSync(o.appsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(o.appsDir, d.name, "manifest.webmanifest")))
      .map((d) => d.name)
      .sort(); // stable order: the dock (and Tab navigation) must not depend on filesystem order
  const manifest = (id: string): Manifest => JSON.parse(readFileSync(join(o.appsDir, id, "manifest.webmanifest"), "utf8"));
  const builtins = (): AppInfo[] =>
    builtinIds()
      .map((id) => [id, manifest(id)] as const)
      .filter(([, m]) => allow(m))
      .map(([id, m]) => ({ id, kind: "builtin", name: m.name, icon: m.brasos?.icon ?? "app", permissions: m.brasos?.permissions ?? [] }));
  const installed = (): AppInfo[] =>
    pwaDir && existsSync(pwaDir)
      ? readdirSync(pwaDir)
          .filter((f) => f.endsWith(".json"))
          .map((f) => JSON.parse(readFileSync(join(pwaDir, f), "utf8")) as AppInfo)
          // an installed PWA carries no `brasos` block, so a policy that requires an opt-in (hardened) hides it
          .filter((a) => allow({ name: a.name, brasos: { permissions: a.permissions } }))
      : [];

  const list = (): AppInfo[] => [...builtins(), ...installed()];
  const get = (id: string) => list().find((a) => a.id === id);

  async function install(manifestUrl: string): Promise<AppInfo> {
    if (!o.fetchManifest || !pwaDir) throw new Error("installing apps is not available");
    const url = new URL(manifestUrl);
    const m = (await o.fetchManifest(url)) as Manifest | null;
    const name = String(m?.name ?? m?.short_name ?? "").trim().slice(0, 60);
    if (!m || !name) throw new Error("manifest has no name");
    const start = new URL(String(m.start_url ?? "/"), url);
    if (start.origin !== url.origin) throw new Error("start_url must be on the manifest's origin");
    const id = "pwa-" + createHash("sha256").update(start.origin + String(m.scope ?? "")).digest("hex").slice(0, 12);
    // permissions are granted by the OS or the user, never self-declared by a remote manifest
    // shortcut: manifest icons are ignored; every PWA gets the same icon
    const app: AppInfo = { id, kind: "pwa", name, icon: "globe", start_url: start.href, permissions: [] };
    mkdirSync(pwaDir, { recursive: true });
    writeFileSync(join(pwaDir, id + ".json"), JSON.stringify(app));
    return app;
  }

  function uninstall(id: string) {
    if (!pwaDir || !/^pwa-[0-9a-f]{12}$/.test(id)) throw new Error("not an installed app");
    rmSync(join(pwaDir, id + ".json"), { force: true });
  }

  const slice: Slice = {
    name: "registry",
    async handle(req, ctx) {
      if (ctx.target.kind !== "shell") return;
      const path = ctx.url.pathname;
      if (path === "/os/apps" && req.method === "GET") {
        const g = ctx.gate("apps.read", { quiet: true });
        return g.ok ? json(list()) : g.res;
      }
      if ((path === "/os/apps/install" || path === "/os/apps/uninstall") && req.method === "POST") {
        const install_ = path.endsWith("/install");
        const g = ctx.gate(install_ ? "apps.install" : "apps.uninstall");
        if (!g.ok) return g.res;
        const body = await req.json().catch(() => null);
        try {
          if (!install_) return uninstall(String(body?.id)), json({ ok: true });
          const app = await install(String(body?.manifestUrl));
          ctx.audit("apps.install", "info", { app: app.id }, { name: app.name, start_url: app.start_url });
          return json(app);
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      }
    },
  };

  return { list, get, has: (id: string) => builtins().some((a) => a.id === id), install, uninstall, slice };
}

export type Registry = ReturnType<typeof createRegistry>;
