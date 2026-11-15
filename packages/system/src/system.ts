// Restarting the interface: the host (and so the shell and every app, rebuilt from source) starts again, so edits to the
// OS's own files take effect. Only exists where a supervisor can restart it (dev image); gated by `system.restart`.
import { json, type AuditFn, type Slice, type Tool } from "@brasos/host/types";

export function createSystem({ restart, audit }: { restart?: () => void; audit: AuditFn }) {
  // answer first, then go: the caller must get its response before the process is replaced
  const go = (by: string) => {
    audit("system.restart", "info", { app: by });
    setTimeout(restart!, 200);
    return { restarting: true };
  };
  const tools: Tool[] = restart
    ? [{ name: "system_restart", capability: "system.restart", destructive: true,
        description: "Restart the OS interface so edits to its source files take effect. Open windows are lost and the screen reloads itself within seconds.",
        inputSchema: { type: "object" }, run: () => go("agent") }]
    : [];
  const slice: Slice = {
    name: "system",
    tools,
    handle(req, ctx) {
      if (ctx.target.kind !== "shell" || req.method !== "POST" || ctx.url.pathname !== "/os/system/restart") return;
      const g = ctx.gate("system.restart", { sameOrigin: true });
      if (!g.ok) return g.res;
      if (!restart) return json({ error: "this system can't restart itself" }, 501);
      return json(go(g.caller.kind === "app" ? g.caller.id : g.caller.kind), 202);
    },
  };
  return { slice };
}
