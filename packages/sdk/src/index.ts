// @brasos/sdk: talk to BrasOS from a web page. Inside BrasOS it calls the host; anywhere else it degrades to
// polyfills so the same code also runs on a plain browser. Importing it also makes the window answer the shell's heartbeat.
import { installHeartbeat, windowState } from "./heartbeat";
import { createMemoryFs, type MemoryFs } from "./memory-fs";

export { createMemoryFs, type MemoryFs };
export { PERMISSIONS, describePermission, type Risk } from "./permissions";
export { isDevtoolsKey, isReloadKey, nativeMenu } from "./heartbeat";

export type AppInfo = {
  id: string;
  kind: "builtin" | "pwa";
  name: string;
  icon: string;
  start_url?: string;
  /** what the app holds: built-in apps, the manifest's list; installed PWAs, what the user granted */
  permissions: string[];
  /** an installed PWA's requests (shown at install), with the reason the app gave for each */
  requested?: { id: string; reason?: string }[];
  /** frame: false = the app draws its own window frame (see `window.frameless`) */
  window?: { frame: boolean };
  /** where an installed PWA runs: in a BrasOS window on the web gateway (default, sandboxed) or in the real browser as an app window (not isolated) */
  runIn?: "brasos" | "browser";
};

export type FsEntry = { name: string; kind: "dir" | "file" | "link"; size: number; mtime: number };
/** an item in the trash: `name` is its name there, `from` where it was deleted from (null if unknown), `deleted` when (ms) */
export type TrashEntry = FsEntry & { from: string | null; deleted: number };

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
  /** listen for messages from the framing shell (used to hear the answer to an install request) */
  listen?: (fn: (e: { data: any; origin: string }) => void) => () => void;
  /** an EventSource for the database's change stream (cross-origin, so the browser's own implementation) */
  eventSource?: (url: string) => { addEventListener(type: string, fn: (e: { data: string }) => void): void; close(): void };
  /** the browser's WebMCP context, looked up when a tool is registered (the API is still moving, so it is optional and best-effort) */
  modelContext?: () => any;
  /** what to use outside BrasOS instead of the real thing (looked up at each call): another fs, and the guides. Storybook sets these. */
  polyfill?: () => { standalone?: boolean; fs?: MemoryFs; docs?: { list(): Promise<{ slug: string; title: string }[]>; page(slug: string): Promise<{ slug: string; title: string; html: string }> } } | undefined;
};

export class UnsupportedError extends Error {}

export function createOS(env: Env) {
  const host = env.location?.hostname ?? "";
  // a page that supplies `standalone` (Storybook, served from localhost) is not BrasOS even though its host name looks like it
  const local = host === "localhost" || host.endsWith(".localhost");
  const inside = () => local && !env.polyfill?.()?.standalone;
  // the host serves its API on the shell origin: http://localhost:<port>
  const base = local ? `${env.location!.protocol}//localhost${env.location!.port ? ":" + env.location!.port : ""}` : "";

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
  // outside BrasOS the fs is an in-memory tree (or the one the page supplies), so apps still run in a plain browser
  let mem: MemoryFs | undefined;
  const poly = () => env.polyfill?.()?.fs ?? (mem ??= createMemoryFs());
  // window messages go to the framing shell, which checks the permission and which window sent them
  const send = async (m: object) => (inside() && env.parent ? (env.parent.postMessage({ brasos: "window", ...m }, base), true) : false);
  // outside BrasOS the database lives in memory, so an app keeps working (and reacting to itself) in a plain browser
  const pdb = new Map<string, Map<string, { rev: number; ts: number; doc: any }>>();
  const pwatch = new Set<(space: string, col: string, e: any) => void>();
  const polyDb = async (space: string, col: string, op: string, b: any) => {
    const t = pdb.get(space + "/" + col) ?? pdb.set(space + "/" + col, new Map()).get(space + "/" + col)!;
    if (op === "put") {
      const id = b.id ?? crypto.randomUUID();
      const rev = (t.get(id)?.rev ?? 0) + 1;
      t.set(id, { rev, ts: Date.now(), doc: structuredClone(b.doc) });
      pwatch.forEach((f) => f(space, col, { op: "put", id, rev, doc: b.doc }));
      return { id, rev };
    }
    if (op === "get") {
      const x = t.get(b.id);
      if (!x) throw new Error("BrasOS /os/db/get: 404 not found");
      return { id: b.id, ...x };
    }
    if (op === "delete") {
      const x = t.get(b.id);
      t.delete(b.id);
      if (x) pwatch.forEach((f) => f(space, col, { op: "delete", id: b.id, rev: x.rev + 1 }));
      return { ok: true, existed: !!x };
    }
    let items = [...t].map(([id, x]) => ({ id, ...x })).filter((r) => Object.entries(b.where ?? {}).every(([k, v]) => (r.doc?.[k] ?? null) === v));
    if (b.order) items.sort((a, c) => (a.doc?.[b.order.field] > c.doc?.[b.order.field] ? 1 : -1) * (b.order.dir === "desc" ? -1 : 1));
    return { items: items.slice(0, b.limit ?? 100) };
  };
  const polyWatch = (space: string, col: string, fn: (e: any) => void) => {
    const f = (s: string, c: string, e: any) => s === space && c === col && fn(e);
    pwatch.add(f);
    return () => void pwatch.delete(f);
  };
  const needsBrasOS = (what: string) => Promise.reject(new UnsupportedError(`${what} needs BrasOS`));

  return {
    /** true when running inside BrasOS (otherwise every call below uses its polyfill) */
    get available() {
      return inside();
    },
    info: () =>
      inside() ? call<{ os: "brasos"; packages: string[] }>("/os/info") : Promise.resolve({ os: null, packages: [] as string[] }),
    /** Asks the shell to offer restarting the computer (the shell shows its own confirmation; only apps that hold `system.update` are heard). Polyfill: false. */
    requestRestart: () => {
      if (!inside() || !env.parent) return false;
      env.parent.postMessage({ brasos: "restart-computer" }, base);
      return true;
    },
    apps: {
      /** polyfill: no apps */
      list: () => (inside() ? call<AppInfo[]>("/os/apps") : Promise.resolve([] as AppInfo[])),
      /** asks the shell to open an app window (`url`, for the browser app, is the web address to show); polyfill: resolves false */
      open: async (id: string, opts: { url?: string } = {}) => {
        if (!inside() || !env.parent) return false;
        env.parent.postMessage({ brasos: "open", id, ...(opts.url ? { url: String(opts.url) } : {}) }, base);
        return true;
      },
      /**
       * Asks to install a PWA from its manifest URL. The SHELL shows the user what the app wants to be able to do and the user
       * decides, so this resolves with the installed app (with the permissions the user granted) or rejects ("cancelled"). Needs
       * the `apps.install` permission to ask. Polyfill: rejects with UnsupportedError.
       */
      install: (manifestUrl: string) => {
        if (!inside()) return needsBrasOS("apps.install");
        if (!env.parent || !env.listen) return Promise.reject(new Error("apps.install needs a BrasOS window"));
        const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
        return new Promise<AppInfo>((resolve, reject) => {
          const stop = env.listen!((e) => {
            if (e.origin !== base || e.data?.brasos !== "install-result" || e.data.nonce !== nonce) return;
            stop();
            e.data.app ? resolve(e.data.app as AppInfo) : reject(new Error(String(e.data.error ?? "install failed")));
          });
          env.parent!.postMessage({ brasos: "install", manifestUrl, nonce }, base);
        });
      },
      uninstall: (id: string) =>
        inside() ? call<{ ok: true }>("/os/apps/uninstall", { id }).then(changed("apps-changed")) : needsBrasOS("apps.uninstall"),
    },
    /**
     * This window, controlled by the app itself. Needs the `window.control` permission (a built-in app lists it; an installed PWA
     * must be granted it). With manifest `window: { frame: false }` BrasOS draws no title bar, so the app draws its own and uses
     * these to drag, resize and close. Each resolves true if the message was sent (the shell ignores it without the permission).
     */
    window: {
      close: () => send({ op: "close" }),
      focus: () => send({ op: "focus" }),
      /** hide the window (the app keeps running; its taskbar button brings it back) */
      minimize: () => send({ op: "minimize" }),
      /** fill the desktop, or go back to the size it had */
      toggleMaximize: () => send({ op: "maximize" }),
      setTitle: (title: string) => send({ op: "title", title: String(title) }),
      /**
       * move by a delta in CSS pixels, e.g. from pointermove (use movementX/Y). Pass `at`, the pointer's clientX/Y, so that a drag
       * of a maximized window can return it to its normal size with the pointer where it was on your title bar.
       */
      moveBy: (dx: number, dy: number, at?: { x: number; y: number }) => send({ op: "moveBy", dx, dy, ...(at ? { x: at.x, y: at.y } : {}) }),
      /** the drag is over (pointerup): a window dropped on the top edge of the page is maximized, and its preview goes away */
      moveEnd: () => send({ op: "moveEnd" }),
      resize: (w: number, h: number) => send({ op: "resize", w, h }),
      /** calls back with true while the shell shows this window maximized, and with false when it is restored; returns the unsubscribe. Calls back at once with the current state. */
      watchMaximized: (fn: (maximized: boolean) => void) => (windowState.subs.add(fn), fn(windowState.max), () => void windowState.subs.delete(fn)),
    },
    /**
     * The OS database: JSON documents in collections, private to this app ("own") or shared between apps that hold `db.shared`.
     * Every write is also a change event, so apps can react to each other: `watch` calls back on every put and delete.
     * Needs `db.own` / `db.shared`. Polyfill outside BrasOS: an in-memory store with the same events.
     */
    db: {
      collection: (col: string, opts: { space?: "own" | "shared" } = {}) => {
        const space = opts.space ?? "own";
        const q = (p: string, b: object) => (inside() ? call<any>("/os/db/" + p, { space, col, ...b }) : polyDb(space, col, p, b));
        return {
          /** insert or replace; without an id one is made. Resolves { id, rev } */
          put: (doc: unknown, id?: string) => q("put", { doc, ...(id === undefined ? {} : { id }) }) as Promise<{ id: string; rev: number }>,
          get: (id: string) => q("get", { id }) as Promise<{ id: string; rev: number; ts: number; doc: any }>,
          /** equality filters on top-level fields, optional ordering and limit (max 1000) */
          list: (query: { where?: Record<string, string | number | boolean | null>; order?: { field: string; dir?: "asc" | "desc" }; limit?: number } = {}) =>
            q("list", query).then((r: { items: { id: string; rev: number; ts: number; doc: any }[] }) => r.items),
          delete: (id: string) => q("delete", { id }) as Promise<{ ok: true; existed: boolean }>,
          /** calls back on every change to this collection; returns an unsubscribe function */
          watch: (fn: (e: { op: "put" | "delete"; id: string; rev: number; doc?: any }) => void): (() => void) => {
            if (!inside()) return polyWatch(space, col, fn);
            const es = env.eventSource?.(`${base}/os/db/events?space=${space}&col=${encodeURIComponent(col)}`);
            if (!es) return () => {};
            es.addEventListener("message", (e) => {
              try {
                fn(JSON.parse(e.data));
              } catch {}
            });
            return () => es.close();
          },
        };
      },
    },
    /** The user's files (a folder tree confined to their BrasOS home: "/Desktop", "/Documents", ...). Polyfill: an in-memory tree. */
    fs: {
      list: (path: string) => (inside() ? call<FsEntry[]>("/os/fs/list", { path }) : poly().list(path)),
      stat: (path: string) => (inside() ? call<FsEntry & { path: string }>("/os/fs/stat", { path }) : poly().stat(path)),
      read: (path: string, maxBytes?: number) =>
        inside()
          ? call<{ path: string; size: number; encoding: "utf8" | "base64"; content: string; truncated: boolean }>("/os/fs/read", { path, maxBytes })
          : poly().read(path, maxBytes),
      write: (path: string, content: string, encoding: "utf8" | "base64" = "utf8") =>
        inside() ? call<{ path: string; size: number }>("/os/fs/write", { path, content, encoding }).then(changed("fs-changed")) : poly().write(path, content, encoding),
      mkdir: (path: string) => (inside() ? call<{ path: string }>("/os/fs/mkdir", { path }).then(changed("fs-changed")) : poly().mkdir(path)),
      move: (from: string, to: string) => (inside() ? call<{ path: string }>("/os/fs/move", { from, to }).then(changed("fs-changed")) : poly().move(from, to)),
      /** moves to the trash (recoverable) */
      remove: (path: string) => (inside() ? call<{ path: string }>("/os/fs/delete", { path }).then(changed("fs-changed")) : poly().remove(path)),
      /** the trash, newest first */
      trash: () => (inside() ? call<TrashEntry[]>("/os/fs/trash", {}) : poly().trash()),
      /** puts a trashed item back where it was (as "name (2)" if that name is taken); returns where it went */
      restore: (name: string) => (inside() ? call<{ path: string }>("/os/fs/restore", { name }).then(changed("fs-changed")) : poly().restore(name)),
      /** deletes one trashed item for good (not recoverable) */
      purge: (name: string) => (inside() ? call<{ removed: number }>("/os/fs/purge", { name }).then(changed("fs-changed")) : poly().purge(name)),
      /** deletes everything in the trash for good (not recoverable) */
      emptyTrash: () => (inside() ? call<{ removed: number }>("/os/fs/purge", { all: true }).then(changed("fs-changed")) : poly().purge()),
    },
    /** The OS's own guides (markdown rendered to HTML on the host). Polyfill: whatever the page supplies, else rejects with UnsupportedError. */
    docs: {
      list: () => (inside() ? call<{ slug: string; title: string }[]>("/os/docs") : env.polyfill?.()?.docs?.list() ?? needsBrasOS("docs")),
      page: (slug: string) => (inside() ? call<{ slug: string; title: string; html: string }>("/os/docs/" + encodeURIComponent(slug)) : env.polyfill?.()?.docs?.page(slug) ?? needsBrasOS("docs")),
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
        inside() ? call<{ url: string; site: string }>("/os/web/open", { url }) : Promise.resolve({ url, site: new URL(url).origin }),
    },
  };
}

const g = globalThis as any;
export const os = createOS({
  location: g.location,
  fetch: (input, init) => g.fetch(input, init),
  parent: g.parent && g.parent !== g ? g.parent : undefined,
  listen: (fn) => (g.addEventListener?.("message", fn), () => g.removeEventListener?.("message", fn)),
  eventSource: (url) => new g.EventSource(url),
  modelContext: () => g.document?.modelContext ?? g.navigator?.modelContext,
  polyfill: () => g.__brasosPolyfill,
});
installHeartbeat(g);
