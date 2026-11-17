// Changing the OS from inside it (dev image only): restart the interface so edits take effect, rebuild the apps without
// restarting, and scaffold a new app. All gated by `system.restart`; present only where a supervisor can restart the host.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { json, type AuditFn, type Slice, type Tool } from "@brasos/host/types";

// "--" is reserved: a restarted window uses `<id>--<n>.localhost`
const ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export type NewApp = { id: string; name: string; icon: string };

/** Validates a request for a new app; returns what to create or why not. Pure, so it is tested without a host. */
export function checkNewApp(input: unknown, exists: (id: string) => boolean): { ok: true; app: NewApp } | { ok: false; error: string; status: number } {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const id = typeof b.id === "string" ? b.id : "";
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const icon = typeof b.icon === "string" && /^[a-z][a-z0-9-]{0,23}$/.test(b.icon) ? b.icon : "app";
  if (id.length < 2 || id.length > 30 || !ID.test(id)) return { ok: false, error: "id: 2-30 lowercase letters, digits and single dashes, starting with a letter", status: 400 };
  if (!name || name.length > 60) return { ok: false, error: "name: 1-60 characters", status: 400 };
  if (exists(id)) return { ok: false, error: `an app called ${id} already exists`, status: 409 };
  return { ok: true, app: { id, name, icon } };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Writes apps/<id>/{manifest.webmanifest,index.html,main.ts}: the smallest app that runs (it shows its own origin). */
export function scaffoldApp(appsDir: string, a: NewApp) {
  const dir = join(appsDir, a.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.webmanifest"), JSON.stringify({ name: a.name, short_name: a.name.slice(0, 12), start_url: "/", display: "standalone", brasos: { icon: a.icon, hardened: false } }, null, 2) + "\n");
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>${esc(a.name)}</title></head>
  <body style="font: 14px system-ui; background: #0c0c0d; color: #ececee; padding: 16px">
    <h3>${esc(a.name)}</h3>
    <p>Runs in its own origin: <code id="o"></code></p>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
`,
  );
  writeFileSync(join(dir, "main.ts"), `import "@brasos/sdk";\n\ndocument.getElementById("o")!.textContent = location.origin;\n`);
}

export function createSystem({ restart, power, rebuild, appsDir, audit }: { restart?: () => void; power?: (action: "poweroff" | "reboot") => void; rebuild?: () => Promise<string[]>; appsDir?: string; audit: AuditFn }) {
  // answer first, then go: the caller must get its response before the process is replaced
  const go = (by: string) => {
    audit("system.restart", "info", { app: by });
    setTimeout(restart!, 200);
    return { restarting: true };
  };
  const dev = !!restart && !!rebuild && !!appsDir;
  const doRebuild = async (by: string) => {
    const apps = await rebuild!();
    audit("system.rebuild", "info", { app: by, apps: apps.length });
    return apps;
  };
  const create = async (input: unknown, by: string) => {
    const c = checkNewApp(input, (id) => existsSync(join(appsDir!, id)));
    if (!c.ok) return { error: c.error, status: c.status };
    scaffoldApp(appsDir!, c.app);
    audit("system.app_create", "info", { app: by, id: c.app.id });
    try {
      await doRebuild(by);
    } catch (e) {
      return { error: `created ${c.app.id} but the build failed: ${(e as Error).message.slice(0, 300)}`, status: 500 };
    }
    return { ...c.app, created: true as const };
  };
  const tools: Tool[] = restart
    ? [{ name: "system_restart", capability: "system.restart", destructive: true,
        description: "Restart the OS interface so edits to its source files take effect. Open windows are lost and the screen reloads itself within seconds.",
        inputSchema: { type: "object" }, run: () => go("agent") }]
    : [];
  if (dev) {
    tools.push(
      { name: "system_rebuild", capability: "system.restart", destructive: false,
        description: "Rebuild the shell and every app from the source on disk without restarting; then reload the page (or the app window) to see the change. An app's server.ts is only loaded by a restart.",
        inputSchema: { type: "object" }, run: async () => ({ rebuilt: await doRebuild("agent") }) },
      { name: "app_create", capability: "system.restart", destructive: false,
        description: "Create a new app (apps/<id>/ with a manifest, index.html and main.ts), rebuild, and make it appear in the launcher. Then edit its files and call system_rebuild.",
        inputSchema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, icon: { type: "string" } }, required: ["id", "name"] },
        run: async (args: unknown) => {
          const r = await create(args, "agent");
          if ("error" in r) throw new Error(r.error);
          return r;
        } },
    );
  }
  const slice: Slice = {
    name: "system",
    tools,
    async handle(req, ctx) {
      if (ctx.target.kind !== "shell" || req.method !== "POST") return;
      const p = ctx.url.pathname;
      if (p === "/os/system/power") {
        const g = ctx.gate("system.power", { sameOrigin: true });
        if (!g.ok) return g.res;
        if (!power) return json({ error: "this system can't power itself off" }, 501);
        const b = (await req.json().catch(() => null)) as { action?: unknown } | null;
        if (b?.action !== "poweroff" && b?.action !== "reboot") return json({ error: "action: poweroff or reboot" }, 400);
        const action = b.action;
        audit("system.power", "info", { app: g.caller.kind === "app" ? g.caller.id : g.caller.kind }, { action });
        setTimeout(() => power(action), 300); // answer first: the caller must get its response before the machine goes down
        return json({ action }, 202);
      }
      if (p !== "/os/system/restart" && p !== "/os/system/rebuild" && p !== "/os/system/app") return;
      const g = ctx.gate("system.restart", { sameOrigin: true });
      if (!g.ok) return g.res;
      if (!restart) return json({ error: "this system can't restart itself" }, 501);
      const by = g.caller.kind === "app" ? g.caller.id : g.caller.kind;
      if (p === "/os/system/restart") return json(go(by), 202);
      if (!dev) return json({ error: "this system can't rebuild itself" }, 501);
      if (p === "/os/system/rebuild") {
        try {
          return json({ rebuilt: await doRebuild(by) });
        } catch (e) {
          return json({ error: (e as Error).message.slice(0, 300) }, 500);
        }
      }
      const r = await create(await req.json().catch(() => null), by);
      return "error" in r ? json({ error: r.error }, r.status) : json(r, 201);
    },
  };
  return { slice };
}
