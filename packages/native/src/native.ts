// Native (non-PWA) windows: the compositor (packages/compositor) owns them; this slice lets the shell list, focus and close
// them through the compositor's control socket. Gated by `native.read` / `native.control`; no app or agent holds either, and
// the hardened package denies both. Without a socket there are no native windows (available: false).
import { connect } from "node:net";
import { json, type AuditFn, type Slice } from "@brasos/host/types";

export type NativeWindow = { id: number; title: string; app: string; focused: boolean };

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
        done(() => resolve((Array.isArray(ws) ? ws : []).map((w: any) => ({ id: Number(w.id) | 0, title: String(w.title ?? "").slice(0, 200), app: String(w.app ?? "").slice(0, 100), focused: w.focused === true }))));
      } catch (e) {
        done(() => reject(e));
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

export function createNative({ socket, audit }: { socket?: string; audit: AuditFn }) {
  const slice: Slice = {
    name: "native",
    async handle(req, ctx) {
      const p = ctx.url.pathname;
      if (ctx.target.kind !== "shell" || !p.startsWith("/os/native")) return;
      if (req.method === "GET" && p === "/os/native") {
        const g = ctx.gate("native.read", { sameOrigin: true });
        if (!g.ok) return g.res;
        if (!socket) return json({ available: false, windows: [] });
        try {
          return json({ available: true, windows: await readWindows(socket) });
        } catch {
          return json({ available: false, windows: [] });
        }
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
