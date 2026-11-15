// @brasos/sdk: talk to BrasOS from a web page. Inside BrasOS it calls the host; anywhere else it degrades to
// polyfills so the same code also runs on a plain browser. Importing it also makes the window answer the shell's heartbeat.
import { installHeartbeat } from "./heartbeat";

export type AppInfo = {
  id: string;
  kind: "builtin" | "pwa";
  name: string;
  icon: string;
  start_url?: string;
  permissions: string[];
};

export type FsEntry = { name: string; kind: "dir" | "file" | "link"; size: number; mtime: number };

/** An action an AI agent can take. Registered with the browser's WebMCP (`document.modelContext`, formerly `navigator.modelContext`) when present. */
export type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly?: boolean;
  execute(args: any): unknown | Promise<unknown>;
};

export type Env = {
  location?: { protocol: string; hostname: string; port: string };
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** the framing window, when there is one (used to ask the shell to open an app) */
  parent?: { postMessage(message: unknown, targetOrigin: string): void };
  /** the browser's WebMCP context, looked up when a tool is registered (the API is still moving, so it is optional and best-effort) */
  modelContext?: () => any;
};

export class UnsupportedError extends Error {}

export function createOS(env: Env) {
  const host = env.location?.hostname ?? "";
  const inside = host === "localhost" || host.endsWith(".localhost");
  // the host serves its API on the shell origin: http://localhost:<port>
  const base = inside ? `${env.location!.protocol}//localhost${env.location!.port ? ":" + env.location!.port : ""}` : "";

  const call = async <T>(path: string, body?: unknown): Promise<T> => {
    const r = await env.fetch(
      base + path,
      body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    );
    if (!r.ok) throw new Error(`BrasOS ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.json() as Promise<T>;
  };
  // tell the shell something it shows is stale (it only refetches; nothing privileged rides on this message)
  const changed = (kind: "apps-changed" | "fs-changed") => <T>(result: T): T => (env.parent?.postMessage({ brasos: kind }, base), result);
  const needsBrasOS = (what: string) => Promise.reject(new UnsupportedError(`${what} needs BrasOS`));

  return {
    /** true when running inside BrasOS (otherwise every call below uses its polyfill) */
    available: inside,
    info: () =>
      inside ? call<{ os: "brasos"; packages: string[] }>("/os/info") : Promise.resolve({ os: null, packages: [] as string[] }),
    apps: {
      /** polyfill: no apps */
      list: () => (inside ? call<AppInfo[]>("/os/apps") : Promise.resolve([] as AppInfo[])),
      /** asks the shell to open an app window; polyfill: resolves false */
      open: async (id: string) => {
        if (!inside || !env.parent) return false;
        env.parent.postMessage({ brasos: "open", id }, base);
        return true;
      },
      /** installs a PWA from its manifest URL; polyfill: rejects with UnsupportedError */
      install: (manifestUrl: string) =>
        inside ? call<AppInfo>("/os/apps/install", { manifestUrl }).then(changed("apps-changed")) : needsBrasOS("apps.install"),
      uninstall: (id: string) =>
        inside ? call<{ ok: true }>("/os/apps/uninstall", { id }).then(changed("apps-changed")) : needsBrasOS("apps.uninstall"),
    },
    /** The user's files (a folder tree confined to their BrasOS home: "/Desktop", "/Documents", ...). Polyfill: rejects with UnsupportedError. */
    fs: {
      list: (path: string) => (inside ? call<FsEntry[]>("/os/fs/list", { path }) : needsBrasOS("fs")),
      stat: (path: string) => (inside ? call<FsEntry & { path: string }>("/os/fs/stat", { path }) : needsBrasOS("fs")),
      read: (path: string, maxBytes?: number) =>
        inside
          ? call<{ path: string; size: number; encoding: "utf8" | "base64"; content: string; truncated: boolean }>("/os/fs/read", { path, maxBytes })
          : needsBrasOS("fs"),
      write: (path: string, content: string, encoding: "utf8" | "base64" = "utf8") =>
        inside ? call<{ path: string; size: number }>("/os/fs/write", { path, content, encoding }).then(changed("fs-changed")) : needsBrasOS("fs"),
      mkdir: (path: string) => (inside ? call<{ path: string }>("/os/fs/mkdir", { path }).then(changed("fs-changed")) : needsBrasOS("fs")),
      move: (from: string, to: string) => (inside ? call<{ path: string }>("/os/fs/move", { from, to }).then(changed("fs-changed")) : needsBrasOS("fs")),
      /** moves to the trash (recoverable) */
      remove: (path: string) => (inside ? call<{ path: string }>("/os/fs/delete", { path }).then(changed("fs-changed")) : needsBrasOS("fs")),
    },
    /** The OS's own guides (markdown rendered to HTML on the host). Polyfill: rejects with UnsupportedError. */
    docs: {
      list: () => (inside ? call<{ slug: string; title: string }[]>("/os/docs") : needsBrasOS("docs")),
      page: (slug: string) => (inside ? call<{ slug: string; title: string; html: string }>("/os/docs/" + encodeURIComponent(slug)) : needsBrasOS("docs")),
    },
    tools: {
      /**
       * Offer an action to AI agents through WebMCP, if the browser has it. Works anywhere (polyfill: does nothing when
       * there's no WebMCP) and never throws, because the API is still changing. Returns an unregister function.
       */
      register(tool: ToolDef): () => void {
        const mc = env.modelContext?.();
        if (!mc || typeof mc.registerTool !== "function") return () => {};
        try {
          const handle = mc.registerTool({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: { readOnlyHint: !!tool.readOnly },
            execute: async (args: unknown) => ({ content: [{ type: "text", text: JSON.stringify((await tool.execute(args)) ?? null) }] }),
          });
          return () => {
            try {
              handle?.unregister ? handle.unregister() : mc.unregisterTool?.(tool.name);
            } catch {}
          };
        } catch {
          return () => {};
        }
      },
    },
    web: {
      /** URL to load a website through the BrasOS gateway; polyfill: the URL itself */
      open: (url: string) =>
        inside ? call<{ url: string; site: string }>("/os/web/open", { url }) : Promise.resolve({ url, site: new URL(url).origin }),
    },
  };
}

const g = globalThis as any;
export const os = createOS({
  location: g.location,
  fetch: (input, init) => g.fetch(input, init),
  parent: g.parent && g.parent !== g ? g.parent : undefined,
  modelContext: () => g.document?.modelContext ?? g.navigator?.modelContext,
});
installHeartbeat(g);
