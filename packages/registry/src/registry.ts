// App registry: the list of things you can open. Built-in apps and installed PWAs are both described by a Web App
// Manifest, so "an app" is just a PWA plus an optional `brasos` block (icon, permissions, hardened opt-in).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { json, type Manifest, type Slice } from "@brasos/host/types";
import { describePermission, type AppInfo, type Risk } from "@brasos/sdk";

export type RegistryOptions = {
  appsDir: string;
  /** where installed PWAs are kept; without it nothing can be installed */
  stateDir?: string;
  /** policies from enabled packages (all must allow) */
  allowApp?: (m: Manifest) => boolean;
  /** what a user may grant an installed PWA; anything else a manifest asks for is shown as unavailable */
  grantable?: readonly string[];
  /** SSRF-safe manifest fetch, injected by the host; absent when installing is not available */
  fetchManifest?: (url: URL) => Promise<unknown>;
};

export type Inspection = {
  name: string;
  origin: string;
  start_url: string;
  /** every permission the manifest asks for, described; `grantable: false` ones can never be granted to a website */
  requested: { id: string; label: string; risk: Risk; reason: string; grantable: boolean }[];
  frameless: boolean;
};

/** a manifest's permission list in one shape: ids (letters, digits, dots) with an optional reason */
function requestsOf(m: Manifest): { id: string; reason: string }[] {
  const seen = new Set<string>();
  const out: { id: string; reason: string }[] = [];
  for (const p of Array.isArray(m.brasos?.permissions) ? m.brasos!.permissions! : []) {
    const id = typeof p === "string" ? p : p && typeof p === "object" ? String((p as any).id) : "";
    if (!/^[a-z][a-z0-9.]{0,39}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, reason: typeof p === "object" ? String((p as any).reason ?? "").slice(0, 200) : "" });
  }
  // asking for no window frame is asking for a permission, so it is shown (and refusable) like any other
  if (m.brasos?.window?.frame === false && !seen.has("window.frameless")) out.push({ id: "window.frameless", reason: "" });
  return out.slice(0, 20);
}

export function createRegistry(o: RegistryOptions) {
  const allow = o.allowApp ?? (() => true);
  const grantable = new Set(o.grantable ?? []);
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
      .map(([id, m]) => ({ id, kind: "builtin" as const, name: m.name, icon: m.brasos?.icon ?? "app", permissions: requestsOf(m).map((r) => r.id), window: { frame: m.brasos?.window?.frame !== false } }));
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

  /** fetch and validate a remote manifest; nothing is stored */
  async function inspectRaw(manifestUrl: string) {
    if (!o.fetchManifest || !pwaDir) throw new Error("installing apps is not available");
    const url = new URL(manifestUrl);
    const m = (await o.fetchManifest(url)) as Manifest | null;
    const name = String(m?.name ?? m?.short_name ?? "").trim().slice(0, 60);
    if (!m || !name) throw new Error("manifest has no name");
    const start = new URL(String(m.start_url ?? "/"), url);
    if (start.origin !== url.origin) throw new Error("start_url must be on the manifest's origin");
    return { m, name, start, requests: requestsOf(m) };
  }

  /** what installing would ask the user: the app's requests, described. The shell shows this before anything is installed. */
  async function inspect(manifestUrl: string): Promise<Inspection> {
    const { m, name, start, requests } = await inspectRaw(manifestUrl);
    return {
      name,
      origin: start.origin,
      start_url: start.href,
      requested: requests.map((r) => ({ id: r.id, ...describePermission(r.id), reason: r.reason, grantable: grantable.has(r.id) })),
      frameless: m.brasos?.window?.frame === false,
    };
  }

  /** `grant` is what the user ticked in the prompt; it is cut down to what the manifest asked for and what a website may hold */
  async function install(manifestUrl: string, grant: string[] = [], runIn: "brasos" | "browser" = "brasos"): Promise<AppInfo> {
    const { m, name, start, requests } = await inspectRaw(manifestUrl);
    const id = "pwa-" + createHash("sha256").update(start.origin + String(m.scope ?? "")).digest("hex").slice(0, 12);
    // a manifest can only ask: the user grants. shortcut: manifest icons are ignored; every PWA gets the same icon
    const granted = requests.map((r) => r.id).filter((p) => grantable.has(p) && grant.includes(p));
    const app: AppInfo = {
      id, kind: "pwa", name, icon: "globe", start_url: start.href, permissions: granted,
      requested: requests,
      runIn: runIn === "browser" ? "browser" : "brasos",
      window: { frame: !(m.brasos?.window?.frame === false && granted.includes("window.frameless")) },
    };
    mkdirSync(pwaDir!, { recursive: true });
    writeFileSync(join(pwaDir!, id + ".json"), JSON.stringify(app));
    return app;
  }

  function uninstall(id: string) {
    if (!pwaDir || !/^pwa-[0-9a-f]{12}$/.test(id)) throw new Error("not an installed app");
    rmSync(join(pwaDir, id + ".json"), { force: true });
  }

  // Apps the BrasOS browser extension asks to add (a site was installed in the real browser): a short queue the shell reads and shows its own
  // install prompt for. Asking installs nothing; the user decides there. In memory only, and a request goes stale after 15 minutes.
  const asked: { id: string; manifestUrl: string; at: number }[] = [];
  const fresh = () => {
    const t = Date.now();
    while (asked.length && t - asked[0].at > 15 * 60_000) asked.shift();
    return asked;
  };

  const slice: Slice = {
    name: "registry",
    async handle(req, ctx) {
      if (ctx.target.kind !== "shell") return;
      const path = ctx.url.pathname;
      if (path === "/os/apps/requests" && req.method === "POST") {
        const g = ctx.gate("apps.request"); // the extension: its own Origin identifies it (no same-origin check: it isn't this origin)
        if (!g.ok) return g.res;
        const b = (await req.json().catch(() => null)) as { manifestUrl?: unknown } | null;
        const u = b?.manifestUrl;
        if (typeof u !== "string" || u.length > 2048 || !/^https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/.test(u)) return json({ error: "manifestUrl must be a plain http(s) address" }, 400);
        const q = fresh();
        if (!q.some((x) => x.manifestUrl === u)) {
          if (q.length >= 20) return json({ error: "too many waiting" }, 429);
          q.push({ id: crypto.randomUUID(), manifestUrl: u, at: Date.now() });
          ctx.audit("apps.request", "info", { app: "extension" }, { host: new URL(u).hostname.slice(0, 100) }); // the site, never the path
        }
        return json({ ok: true }, 202);
      }
      if (path === "/os/apps/requests" && req.method === "GET") {
        const g = ctx.gate("apps.install", { quiet: true });
        return g.ok ? json({ requests: fresh().map(({ id, manifestUrl }) => ({ id, manifestUrl })) }) : g.res;
      }
      if (path === "/os/apps/requests/dismiss" && req.method === "POST") {
        const g = ctx.gate("apps.install", { sameOrigin: true });
        if (!g.ok) return g.res;
        const id = String(((await req.json().catch(() => null)) as { id?: unknown } | null)?.id);
        const i = asked.findIndex((x) => x.id === id);
        if (i >= 0) asked.splice(i, 1);
        return json({ ok: true });
      }
      if (path === "/os/apps" && req.method === "GET") {
        const g = ctx.gate("apps.read", { quiet: true });
        return g.ok ? json(list()) : g.res;
      }
      // install and inspect are the shell's: it shows the permission prompt, so no page can install an app (or grant itself
      // anything) by calling the host directly. An app that wants one installed asks the shell (see the SDK's apps.install).
      if ((path === "/os/apps/install" || path === "/os/apps/inspect" || path === "/os/apps/uninstall") && req.method === "POST") {
        const op = path.slice("/os/apps/".length);
        const g = ctx.gate(op === "uninstall" ? "apps.uninstall" : "apps.install", { sameOrigin: true });
        if (!g.ok) return g.res;
        const body = await req.json().catch(() => null);
        try {
          if (op === "uninstall") return uninstall(String(body?.id)), json({ ok: true });
          if (op === "inspect") return json(await inspect(String(body?.manifestUrl)));
          const grant = Array.isArray(body?.grant) ? body.grant.filter((x: unknown) => typeof x === "string") : [];
          const app = await install(String(body?.manifestUrl), grant, body?.runIn === "browser" ? "browser" : "brasos");
          ctx.audit("apps.install", "info", { app: app.id }, { name: app.name, start_url: app.start_url, runIn: app.runIn, granted: app.permissions, requested: (app.requested ?? []).map((r) => r.id) });
          return json(app);
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      }
    },
  };

  return { list, get, has: (id: string) => builtins().some((a) => a.id === id), install, inspect, uninstall, slice };
}

export type Registry = ReturnType<typeof createRegistry>;
