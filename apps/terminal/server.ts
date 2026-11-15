// The terminal app's server side: a PTY over WebSocket. This is full user access, so it is only reachable by an
// app whose manifest declares the "pty" permission, from its own origin, and never when a policy (hardened) forbids it.
import type { AuditFn, Slice } from "@brasos/host/types";

const SHELL = process.platform === "win32" ? ["powershell.exe"] : ["bash", "-l"];

export const createSlice = ({ audit }: { audit: AuditFn }): Slice => ({
  name: "terminal",
  handle(req, ctx) {
    if (ctx.url.pathname !== "/pty") return;
    // sameOrigin: a page may only open a PTY on its own origin (blocks cross-site WebSocket hijacking)
    const g = ctx.gate("pty", { sameOrigin: true });
    if (!g.ok) return g.res;
    if (!ctx.upgrade("terminal")) return new Response("upgrade failed", { status: 400 });
  },
  ws: {
    open(ws) {
      ws.data.started = Date.now();
      ws.data.proc = Bun.spawn(SHELL, {
        cwd: process.env.HOME ?? process.env.USERPROFILE,
        env: { ...process.env, TERM: "xterm-256color" },
        terminal: { cols: 80, rows: 24, data: (_t, d) => ws.send(d) },
        onExit: () => ws.close(),
      });
      audit("pty.session", "info", { app: "terminal" }, { state: "open", pid: ws.data.proc.pid });
    },
    message(ws, raw) {
      const m = JSON.parse(String(raw));
      const term = ws.data.proc?.terminal;
      if (m.t === "i") term?.write(m.d);
      else if (m.t === "r") term?.resize(m.cols, m.rows);
    },
    close(ws) {
      ws.data.proc?.kill();
      audit("pty.session", "info", { app: "terminal" }, {
        state: "close",
        pid: ws.data.proc?.pid,
        seconds: Math.round((Date.now() - (ws.data.started ?? Date.now())) / 1000),
      });
    },
  },
});
