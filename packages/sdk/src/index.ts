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

export type Env = {
  location?: { protocol: string; hostname: string; port: string };
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** the framing window, when there is one (used to ask the shell to open an app) */
  parent?: { postMessage(message: unknown, targetOrigin: string): void };
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
  // tell the shell its app list is stale (it only refetches the list; nothing privileged rides on this message)
  const changed = <T>(result: T): T => (env.parent?.postMessage({ brasos: "apps-changed" }, base), result);
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
        inside ? call<AppInfo>("/os/apps/install", { manifestUrl }).then(changed) : needsBrasOS("apps.install"),
      uninstall: (id: string) =>
        inside ? call<{ ok: true }>("/os/apps/uninstall", { id }).then(changed) : needsBrasOS("apps.uninstall"),
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
});
installHeartbeat(g);
