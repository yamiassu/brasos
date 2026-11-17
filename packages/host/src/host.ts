// The host: serves every origin, enforces the capability gate, and composes the slices. It knows no feature itself;
// registry, web gateway and the terminal plug in as slices (see the list below).
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createAudit, type Sink } from "@brasos/audit";
import { createAgent } from "@brasos/agent";
import { createDocs } from "@brasos/docs";
import { createFiles } from "@brasos/files";
import { createRegistry } from "@brasos/registry";
import { createSetup } from "@brasos/setup";
import { createSystem } from "@brasos/system";
import { createNative } from "@brasos/native";
import { createDb } from "@brasos/db";
import { createGateway, readText } from "@brasos/web-gateway";
import { build } from "./build";
import { resolvePolicies } from "./packages";
import { json, text, type Ctx, type Gate, type Slice, type Target } from "./types";

export type HostOptions = {
  /** repo root: contains packages/ and apps/ */
  root: string;
  /** 0 picks a free port */
  port?: number;
  /** enabled packages, e.g. ["hardened"]; unknown names throw */
  packages?: string[];
  dist?: string;
  /** dist was built at image build time: serve it, never build */
  prebuilt?: boolean;
  /** build into dist and return without serving */
  buildOnly?: boolean;
  stateDir?: string;
  /** the user's files live here (default: <stateDir>/home; without either, files are unavailable) */
  home?: string;
  /** markdown guides (default: <root>/docs/guide) */
  docsDir?: string;
  audit?: Sink[];
  /** how this system restarts itself (the supervisor's command); without it there is no restart route or tool */
  restart?: () => void;
  /** how this system powers off or reboots (the supervisor's command); without it there is no power route */
  power?: (action: "poweroff" | "reboot") => void;
  /** a JSON file that provisions the first-boot account and preferences without the installer (see packages/setup) */
  setupPreseed?: string;
  /** development only: skip the installer and the lock screen (see packages/setup); ignored when any package is enabled */
  setupDevSkip?: boolean;
  /** the compositor's control socket: where native windows are listed and driven (see packages/native); without it there are none */
  nativeSocket?: string;
  /** JSON list of the image's native apps ([{id,name,icon}]); launching is by id only (see packages/native) */
  nativeApps?: string;
  /** gateway tuning; allowPrivate is tests only (lets it reach loopback upstreams) */
  gateway?: { allowPrivate?: boolean; maxSites?: number };
};

/** capabilities the shell UI itself holds (it lists apps and opens PWA windows) */
const SHELL_CAPS = ["apps.read", "apps.uninstall", "web.open", "fs.read", "docs.read", "ui.host", "system.restart", "system.power", "setup.write", "setup.login", "apps.install", "native.read", "native.control", "db.own", "db.shared"];
/** what a user can grant an installed PWA (never anything that controls the OS itself); a PWA window is a website to the host, so these are checked again at the gate */
export const PWA_GRANTABLE = ["fs.read", "fs.write", "docs.read", "db.own", "db.shared", "window.control", "window.frameless", "apps.open"];
/** what an authenticated AI agent may do (on top of each tool's own check and the enabled packages' policies) */
const AGENT_CAPS = ["agent.call", "apps.read", "fs.read", "fs.write", "docs.read", "ui.control", "system.restart"];

/** localhost = shell, <id>.localhost = app, <id>.web.localhost = website (32 hex chars), <id>--<n>.localhost = restarted app window */
function targetOf(host: string): Target | null {
  if (host === "localhost") return { kind: "shell" };
  if (!host.endsWith(".localhost")) return null;
  const label = host.slice(0, -".localhost".length);
  const site = label.match(/^([0-9a-f]{32})\.web$/);
  if (site) return { kind: "site", id: site[1] };
  return /^[a-z0-9-]+$/.test(label) ? { kind: "app", id: label.split("--")[0] } : null;
}

export async function startHost(o: HostOptions) {
  const root = resolve(o.root);
  const dist = resolve(o.dist ?? join(root, "dist"));
  const policies = resolvePolicies(o.packages ?? []);
  const audit = createAudit(o.audit ?? []);

  const gateway = createGateway({ stateDir: o.stateDir, ...o.gateway });
  const registry = createRegistry({
    appsDir: join(root, "apps"),
    grantable: PWA_GRANTABLE,
    stateDir: o.stateDir,
    allowApp: (m) => policies.every((p) => p.allowApp?.(m) ?? true),
    fetchManifest: async (url) => {
      const res = await gateway.fetchPublic(url, { follow: 3, headers: { accept: "application/manifest+json, application/json" } });
      if (!res.ok) throw new Error(`manifest fetch failed: ${res.status}`);
      return JSON.parse(await readText(res, 256 * 1024));
    },
  });

  if (!o.prebuilt) {
    await build({ root, dist, appIds: registry.list().filter((a) => a.kind === "builtin").map((a) => a.id) });
  }
  // dev: rebuild the shell and the apps from the source on disk (new apps included) without restarting
  const rebuildApps = async () => {
    const appIds = registry.list().filter((a) => a.kind === "builtin").map((a) => a.id);
    await build({ root, dist, appIds });
    return appIds;
  };
  if (o.buildOnly) return { port: 0, stop() {} };

  // The composition root. Packages are listed here; an app contributes server code by shipping apps/<id>/server.ts
  // exporting createSlice({ audit }), and it is loaded only if the registry admits the app (so hardened never imports it).
  const appSlices: Slice[] = await Promise.all(
    registry
      .list()
      .filter((a) => a.kind === "builtin" && existsSync(join(root, "apps", a.id, "server.ts")))
      .map(async (a) => (await import(pathToFileURL(join(root, "apps", a.id, "server.ts")).href)).createSlice({ audit }) as Slice),
  );
  const files = createFiles({ home: o.home ?? (o.stateDir && join(o.stateDir, "home")) });
  const docs = createDocs({ dir: o.docsDir ?? join(root, "docs/guide") });
  /** the installed PWA whose origin is this site (same origin = same app, as on the web) */
  const pwaForSite = (siteId: string) => registry.list().find((a) => a.kind === "pwa" && a.start_url && gateway.idOf(new URL(a.start_url).origin) === siteId);
  const db = createDb({
    stateDir: o.stateDir,
    audit,
    ownerOf: (c) => (c.kind === "shell" ? "shell" : c.kind === "app" ? (registry.get(c.id) ? c.id : null) : (pwaForSite(c.id)?.id ?? null)),
  });
  const slices: Slice[] = [registry.slice, gateway.slice, files.slice, docs.slice, createSystem({ restart: o.restart, power: o.power, rebuild: o.prebuilt ? undefined : rebuildApps, appsDir: join(root, "apps"), audit }).slice, createSetup({ stateDir: o.stateDir, audit, preseed: o.setupPreseed, devSkip: !!o.setupDevSkip && policies.length === 0 }).slice, createNative({ socket: o.nativeSocket, apps: o.nativeApps, audit }).slice, db.slice];
  const agent = createAgent({ tools: () => slices.flatMap((s) => s.tools ?? []), stateDir: o.stateDir });
  slices.push(agent.slice, ...appSlices);
  const bySlice = new Map(slices.map((s) => [s.name, s]));

  /** caller identity comes from the browser-set Origin header (a page can't forge it); same-origin GETs carry Sec-Fetch-Site instead */
  function callerOf(req: Request, url: URL): Target | null {
    const origin = req.headers.get("origin");
    if (origin) {
      try {
        const u = new URL(origin);
        return u.protocol === "http:" && u.port === url.port ? targetOf(u.hostname) : null;
      } catch {
        return null;
      }
    }
    return req.headers.get("sec-fetch-site") === "same-origin" ? targetOf(url.hostname) : null;
  }

  const cors = (res: Response, req: Request, url: URL) => {
    const origin = req.headers.get("origin");
    const caller = origin ? callerOf(req, url) : null;
    if (url.pathname.startsWith("/os/") && origin && caller && (caller.kind !== "app" || registry.has(caller.id))) {
      res.headers.set("access-control-allow-origin", origin);
      res.headers.set("access-control-allow-methods", "GET, POST");
      res.headers.set("access-control-allow-headers", "content-type");
      res.headers.append("vary", "Origin");
    }
    return res;
  };

  function gateFor(req: Request, url: URL) {
    return (cap: string, opts?: { sameOrigin?: boolean; quiet?: boolean }): Gate => {
      const caller = callerOf(req, url);
      const label = !caller ? "unknown" : caller.kind === "app" ? (registry.has(caller.id) ? caller.id : "unknown-app") : caller.kind;
      const permitted =
        caller?.kind === "shell" ? SHELL_CAPS.includes(cap) : caller?.kind === "app" ? !!registry.get(caller.id)?.permissions.includes(cap)
          : caller?.kind === "site" ? PWA_GRANTABLE.includes(cap) && !!pwaForSite(caller.id)?.permissions.includes(cap) : false;
      const ok =
        !!caller && permitted && policies.every((p) => p.allowCapability?.(cap) ?? true) &&
        (!opts?.sameOrigin || req.headers.get("origin") === url.origin);
      audit(`capability.${cap}`, ok ? "allow" : "deny", { app: label, origin: (req.headers.get("origin") ?? "").slice(0, 100) }, {},
        ok && !opts?.quiet ? undefined : { key: `${ok ? "allow" : "deny"}:${cap}:${label}`, ms: 1000 });
      return ok ? { ok, caller: caller! } : { ok, res: cors(json({ error: "denied" }, 403), req, url) };
    };
  }

  const server = Bun.serve<Record<string, any>>({
    hostname: "127.0.0.1", // the PTY is full user access: never listen beyond loopback
    port: o.port ?? 0,
    async fetch(req, server) {
      const url = new URL(req.url);
      const target = targetOf(url.hostname);
      if (!target) {
        audit("request.rejected", "deny", { host: url.hostname.slice(0, 100) }, { reason: "host not allowed" }, { key: "bad-host", ms: 10_000 });
        return text("bad host", 403);
      }
      if (target.kind === "app" && !registry.has(target.id)) {
        audit("app.unknown", "deny", { app: target.id.slice(0, 64) }, {}, { key: "app-unknown", ms: 10_000 });
        return text("no such app", 404);
      }

      if (req.method === "OPTIONS" && url.pathname.startsWith("/os/")) {
        const res = cors(new Response(null, { status: 204 }), req, url);
        return res.headers.has("access-control-allow-origin") ? res : text("forbidden", 403);
      }

      let upgraded = false;
      const ctx: Ctx = {
        url,
        target,
        audit,
        gate: gateFor(req, url),
        allow(cap, as, detail) {
          const ok = as === "agent" && AGENT_CAPS.includes(cap) && policies.every((p) => p.allowCapability?.(cap) ?? true);
          audit(`capability.${cap}`, ok ? "allow" : "deny", { app: as }, detail ?? {}, ok ? undefined : { key: `deny:${cap}:${as}`, ms: 1000 });
          return ok;
        },
        upgrade: (slice, data) => (upgraded = server.upgrade(req, { data: { ...data, slice } })),
      };

      if (target.kind === "shell" && url.pathname === "/os/info") {
        return cors(json({ os: "brasos", packages: policies.map((p) => p.name), restart: !!o.restart && policies.every((p) => p.allowCapability?.("system.restart") ?? true), power: !!o.power && policies.every((p) => p.allowCapability?.("system.power") ?? true) }), req, url);
      }
      if (url.pathname === "/__brasos/devtools.js") {
        // the in-page devtools (vendored Eruda): only to a website opened through the gateway, and never when a package (hardened) is on
        if (target.kind !== "site" || policies.length) return text("not found", 404);
        return new Response(Bun.file(join(root, "packages/web-gateway/vendor/eruda.js")), { headers: { "content-type": "text/javascript; charset=utf-8" } });
      }
      if (url.pathname === "/__brasos/sdk.js") {
        return new Response(Bun.file(join(dist, "__brasos/sdk.js")), { headers: { "content-type": "text/javascript; charset=utf-8" } });
      }

      for (const s of slices) {
        const res = await s.handle?.(req, ctx);
        if (upgraded) return;
        if (res) return cors(res, req, url);
      }
      if (target.kind === "site") return text("not found", 404);

      if (target.kind === "app" && url.pathname === "/") audit("app.load", "allow", { app: target.id }, {}, { key: `app.load:${target.id}`, ms: 1000 });
      const base = target.kind === "app" ? `apps/${target.id}` : "packages/shell/src";
      const rel = url.pathname === "/" ? "/index.html" : url.pathname;
      for (const p of [join(dist, base, rel), join(dist, rel)]) {
        if (!p.startsWith(dist)) continue;
        const f = Bun.file(p);
        if (await f.exists()) return new Response(f);
      }
      return text("not found", 404);
    },
    websocket: {
      open: (ws) => bySlice.get(ws.data.slice)?.ws?.open(ws),
      message: (ws, raw) => bySlice.get(ws.data.slice)?.ws?.message(ws, raw),
      close: (ws) => bySlice.get(ws.data.slice)?.ws?.close(ws),
    },
  });

  audit("server.start", "info", {}, { packages: policies.map((p) => p.name), port: server.port, apps: registry.list().map((a) => a.id) });
  return { port: server.port as number, stop: () => (server.stop(true), db.close()) };
}
