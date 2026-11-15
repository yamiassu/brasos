import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = import.meta.dir;
const PORT = Number(process.env.PORT ?? 7000);
// "hardened" serves only apps that opt in via manifest "profiles" (default deny), never builds at runtime
// and never exposes the PTY. Anything but the exact string "hardened" means dev.
const PROFILE = process.env.BRASOS_PROFILE === "hardened" ? "hardened" : "dev";
const DIST = process.env.BRASOS_DIST ?? join(ROOT, "dist");
const manifest = (id: string) => JSON.parse(readFileSync(join(ROOT, "apps", id, "manifest.json"), "utf8"));
const appIds = () =>
  readdirSync(join(ROOT, "apps"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(ROOT, "apps", d.name, "manifest.json")))
    .map((d) => d.name)
    .filter((id) => (manifest(id).profiles ?? ["dev"]).includes(PROFILE))
    .sort(); // stable order: the dock (and Tab navigation) must not depend on filesystem order

// BRASOS_PREBUILT=1: dist was built at image build time (Nix); `--build-only` is how that build runs.
if (!process.env.BRASOS_PREBUILT) {
  const built = await Bun.build({
    entrypoints: ["shell", ...appIds().map((a) => `apps/${a}`)].map((d) => join(ROOT, d, "index.html")),
    outdir: DIST,
    root: ROOT,
  });
  if (!built.success) {
    console.error(built.logs.join("\n"));
    process.exit(1);
  }
}
if (process.argv.includes("--build-only")) process.exit(0);

// Each app is its own origin (<id>.localhost) so Chromium puts it in its own process.
// A restarted window gets <id>--<n>.localhost, a fresh origin and therefore a fresh process.
const SHELL = process.platform === "win32" ? ["powershell.exe"] : ["bash", "-l"];

Bun.serve<{ proc?: Bun.Subprocess }>({
  hostname: "127.0.0.1", // PTY = full user access: never listen beyond loopback
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);
    const host = url.hostname;
    if (host !== "localhost" && !host.endsWith(".localhost")) return new Response("bad host", { status: 403 });
    const app = host === "localhost" ? null : host.slice(0, -".localhost".length).split("--")[0];
    if (app && !appIds().includes(app)) return new Response("no such app", { status: 404 });

    // Capability gate: only the terminal app gets a PTY. Origin check blocks other web pages
    // (cross-site WebSocket hijacking) from reaching it.
    if (url.pathname === "/pty" && PROFILE === "dev") {
      const ok = app === "terminal" && req.headers.get("origin") === url.origin;
      if (ok && server.upgrade(req, { data: {} })) return;
      return new Response("forbidden", { status: 403 });
    }

    if (!app && url.pathname === "/api/apps") return Response.json(appIds().map((id) => ({ id, ...manifest(id) })));
    if (!app && url.pathname === "/api/profile") return Response.json({ profile: PROFILE });

    const base = app ? `apps/${app}` : "shell";
    const rel = url.pathname === "/" ? "/index.html" : url.pathname;
    for (const p of [join(DIST, base, rel), join(DIST, rel)]) {
      if (!p.startsWith(DIST)) continue;
      const f = Bun.file(p);
      if (await f.exists()) return new Response(f);
    }
    return new Response("not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      ws.data.proc = Bun.spawn(SHELL, {
        cwd: process.env.HOME ?? process.env.USERPROFILE,
        env: { ...process.env, TERM: "xterm-256color" },
        terminal: { cols: 80, rows: 24, data: (_t, d) => ws.send(d) },
        onExit: () => ws.close(),
      });
    },
    message(ws, raw) {
      const m = JSON.parse(String(raw));
      const term = ws.data.proc?.terminal;
      if (m.t === "i") term?.write(m.d);
      else if (m.t === "r") term?.resize(m.cols, m.rows);
    },
    close(ws) {
      ws.data.proc?.kill();
    },
  },
});
console.log(`BrasOS shell on http://localhost:${PORT}`);
