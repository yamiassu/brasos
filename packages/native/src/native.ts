// Native (non-PWA) windows: the compositor (packages/compositor) owns them; this slice lets the shell list, focus and close
// them through the compositor's control socket. Gated by `native.read` / `native.control`; no app or agent holds either, and
// the hardened package denies both. Without a socket there are no native windows (available: false).
import { readFileSync } from "node:fs";
import { connect } from "node:net";
import { json, type AuditFn, type Slice } from "@brasos/host/types";

/** a Flatpak application id (reverse DNS), the rule the compositor checks again */
export const safeAppId = (a: unknown): a is string => typeof a === "string" && a.length <= 150 && /^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+){2,}$/.test(a);

/** the Flatpak apps this user installed (`flatpak list --user --app`), where the image has Flatpak (BRASOS_FLATPAK); [] otherwise. Reading only. */
export async function listFlatpaks(bin = process.env.BRASOS_FLATPAK): Promise<{ id: string; name: string; version: string }[]> {
  const cmd = (bin ?? "").split(" ").filter(Boolean);
  if (!cmd.length) return [];
  try {
    const p = Bun.spawn([...cmd, "list", "--user", "--app", "--columns=application,name,version"], { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
    const out = await new Response(p.stdout).text();
    if ((await p.exited) !== 0) return [];
    return out.split("\n").map((l) => l.trim().split("\t")).filter((c) => safeAppId(c[0])).map((c) => ({ id: c[0], name: (c[1] || c[0]).slice(0, 80), version: (c[2] ?? "").slice(0, 40) }));
  } catch {
    return [];
  }
}

export type NativeApp = { id: string; name: string; icon: string; takesUrl: boolean };

/** the one address an app that takes one may be started with (the compositor checks the same rule again): http(s), bounded, URL characters only */
export const safeUrl = (u: unknown): u is string => typeof u === "string" && u.length <= 2048 && /^https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/.test(u);
export type NativeWindow = { id: number; title: string; app: string; focused: boolean; w: number; h: number; ssd: boolean; x: number; y: number };

const clamp = (v: unknown, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0));

/** read the first line the compositor sends, or give up after `ms` */
function readWindows(path: string, ms = 1000): Promise<NativeWindow[]> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const s = connect(path);
    const done = (f: () => void) => (clearTimeout(t), s.destroy(), f());
    const t = setTimeout(() => done(() => reject(new Error("timeout"))), ms);
    s.on("error", (e) => done(() => reject(e)));
    s.on("data", (d) => {
      buf += d;
      if (buf.length > 256 * 1024) return done(() => reject(new Error("too large")));
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      try {
        const ws = JSON.parse(buf.slice(0, nl)).windows;
        // the compositor is trusted but the shell renders this: keep only the fields we know, with their types
        done(() => resolve((Array.isArray(ws) ? ws : []).map((w: any) => ({ id: Number(w.id) >>> 0, // window ids are u32 hashes: `| 0` would turn the upper half negative, and focus/close/place would refuse them
           title: String(w.title ?? "").slice(0, 200), app: String(w.app ?? "").slice(0, 100), focused: w.focused === true, w: clamp(w.w, 0, 16384), h: clamp(w.h, 0, 16384), ssd: w.ssd !== false, x: clamp(w.x, -32768, 32768), y: clamp(w.y, -32768, 32768) }))));
      } catch (e) {
        done(() => reject(e));
      }
    });
  });
}

/** a small picture of one window (raw RGB, base64): ask on a fresh connection and wait for the line that answers. null when it can't be had. */
export function readThumb(path: string, id: number, ms = 1500): Promise<{ w: number; h: number; rgb: string } | null> {
  return new Promise((resolve) => {
    let buf = "";
    const s = connect(path, () => s.write(`{"thumb":${id}}\n`));
    const done = (v: { w: number; h: number; rgb: string } | null) => (clearTimeout(t), s.destroy(), resolve(v));
    const t = setTimeout(() => done(null), ms);
    s.on("error", () => done(null));
    s.on("data", (d) => {
      buf += d;
      if (buf.length > 256 * 1024) return done(null);
      for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        let m: any;
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        if (m?.thumb !== id) continue; // the window list comes first on every connection
        // the compositor is trusted but the shell draws this: the sizes must fit and the bytes must be exactly width x height x 3
        const ok = Number.isInteger(m.w) && Number.isInteger(m.h) && m.w >= 1 && m.w <= 256 && m.h >= 1 && m.h <= 256 && typeof m.rgb === "string" && m.rgb.length === m.w * m.h * 4 && /^[A-Za-z0-9+/]+={0,2}$/.test(m.rgb);
        return done(ok ? { w: m.w, h: m.h, rgb: m.rgb } : null);
      }
    });
  });
}

function send(path: string, line: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = connect(path, () => s.end(line, () => resolve()));
    s.on("error", reject);
  });
}

/** the image's list of native apps (JSON: [{id,name,icon}]); the command lines are not here: only the compositor knows them */
function loadApps(path?: string): NativeApp[] {
  if (!path) return [];
  try {
    return (JSON.parse(readFileSync(path, "utf8")) as any[])
      .filter((a) => /^[a-z0-9-]{1,40}$/.test(a?.id))
      .map((a) => ({ id: a.id, name: String(a.name ?? a.id).slice(0, 80), icon: String(a.icon ?? "app").slice(0, 40), takesUrl: a.takesUrl === true }));
  } catch {
    return [];
  }
}

export function createNative({ socket, apps: appsFile, audit }: { socket?: string; apps?: string; audit: AuditFn }) {
  const apps = loadApps(appsFile);
  const slice: Slice = {
    name: "native",
    async handle(req, ctx) {
      const p = ctx.url.pathname;
      if (ctx.target.kind !== "shell" || !p.startsWith("/os/native")) return;
      if (req.method === "GET" && p === "/os/native") {
        const g = ctx.gate("native.read");
        if (!g.ok) return g.res;
        if (!socket) return json({ available: false, windows: [] });
        try {
          return json({ available: true, windows: await readWindows(socket) });
        } catch {
          return json({ available: false, windows: [] });
        }
      }
      // a picture of a window for the switcher; many are asked for at once, so the allows are not written to the trail one by one
      if (req.method === "GET" && p === "/os/native/thumb") {
        const g = ctx.gate("native.read", { quiet: true });
        if (!g.ok) return g.res;
        const id = Number(ctx.url.searchParams.get("id"));
        if (!Number.isInteger(id) || id <= 0 || id > 0xffffffff) return json({ error: "id must be a window id" }, 400);
        const t = socket ? await readThumb(socket, id) : null;
        return t ? json(t) : json({ error: "no picture of that window" }, 404);
      }
      if (req.method === "GET" && p === "/os/native/apps") {
        const g = ctx.gate("native.read");
        if (!g.ok) return g.res;
        // the image's apps, then the Flatpak apps the user installed (ids `flatpak:<application id>`)
        const fp = socket ? (await listFlatpaks()).map((f) => ({ id: `flatpak:${f.id}`, name: f.name, icon: "app", takesUrl: false })) : [];
        return json({ apps: socket ? [...apps, ...fp] : [] });
      }
      if (req.method === "POST" && p === "/os/native/launch") {
        const g = ctx.gate("native.control", { sameOrigin: true });
        if (!g.ok) return g.res;
        const b = (await req.json().catch(() => null)) as any;
        const id = b?.id;
        if (typeof id === "string" && id.startsWith("flatpak:")) {
          // an installed Flatpak app: the id is checked as an application id and must be in the user's own list; the runner is fixed
          const appId = id.slice(8);
          if (!socket || !safeAppId(appId) || !(await listFlatpaks()).some((f) => f.id === appId)) return json({ error: "unknown native app" }, 404);
          audit("native.launch", "info", { id }, { flatpak: appId });
          await send(socket, `{"run":"flatpak","app":"${appId}"}
`).catch(() => {});
          return json({ ok: true }, 202);
        }
        // only ids from the image's list: no request can name a command
        const app = typeof id === "string" && socket ? apps.find((a) => a.id === id) : undefined;
        if (!app) return json({ error: "unknown native app" }, 404);
        if (b.url !== undefined) {
          // an address goes only to an app the image marked as taking one, and only a plain http(s) one
          if (!app.takesUrl || !safeUrl(b.url)) return json({ error: "this app does not take that address" }, 400);
          audit("native.launch", "info", { id }, { host: new URL(b.url).hostname.slice(0, 100) }); // the site, never the path or query
          await send(socket!, `{"open":"${id}","url":"${b.url}"}
`).catch(() => {});
          return json({ ok: true }, 202);
        }
        audit("native.launch", "info", { id });
        await send(socket!, `{"launch":"${id}"}
`).catch(() => {});
        return json({ ok: true }, 202);
      }
      // the shell draws the window frame and tells the compositor where the window's content goes (the shell is the window manager)
      if (req.method === "POST" && p === "/os/native/place") {
        const g = ctx.gate("native.control", { sameOrigin: true, quiet: true }); // a drag sends many: allows are throttled in the trail
        if (!g.ok) return g.res;
        const b = (await req.json().catch(() => null)) as any;
        const ok = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
        if (!b || !ok(b.id, 1, 0xffffffff) || !ok(b.x, -8192, 16384) || !ok(b.y, -8192, 16384) || !ok(b.w, 64, 16384) || !ok(b.h, 48, 16384)) return json({ error: "id, x, y, w, h must be integers in range" }, 400);
        if (!socket) return json({ error: "no native windows on this system" }, 501);
        await send(socket, `{"place":[${b.id},${b.x},${b.y},${b.w},${b.h}]}\n`).catch(() => {});
        return json({ ok: true });
      }
      const op = req.method === "POST" && (p === "/os/native/focus" ? "focus" : p === "/os/native/close" ? "close" : "");
      if (!op) return;
      const g = ctx.gate("native.control", { sameOrigin: true });
      if (!g.ok) return g.res;
      const id = ((await req.json().catch(() => null)) as any)?.id;
      if (!Number.isInteger(id) || id <= 0 || id > 0xffffffff) return json({ error: "id must be a window id" }, 400);
      if (!socket) return json({ error: "no native windows on this system" }, 501);
      audit(`native.${op}`, "info", { id });
      await send(socket, `{"${op}":${id}}\n`).catch(() => {});
      return json({ ok: true });
    },
  };
  return { slice };
}
