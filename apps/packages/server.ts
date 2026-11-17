// The Packages app's server side: the packages of the running system, read from the Nix store (`packages.read`). The system's
// software is fixed by its image, so there is no install or remove here: the app says so rather than pretending. The list is the
// set the system profile links (/run/current-system/sw); the dependencies shown between them are the store's own references.
import { realpathSync } from "node:fs";
import type { Slice } from "@brasos/host/types";
import { json } from "@brasos/host/types";

export type Kind = "App" | "Driver" | "Library" | "Tool";
export type Pkg = { id: string; name: string; kind: Kind; version: string; size: number; summary: string; deps: string[] }; // size in MB
type Info = Map<string, { narSize: number; references: string[] }>;

const STORE = /^\/nix\/store\/[0-9a-z]{32}-(.+)$/;

/** `nix path-info --json -r`: an array of {path, ...} (older Nix) or an object keyed by path (newer). Pure. */
export function parsePathInfo(text: string): Info {
  const out: Info = new Map();
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return out;
  }
  const rows: [string, any][] = Array.isArray(v) ? v.map((x) => [x?.path, x]) : v && typeof v === "object" ? Object.entries(v) : [];
  for (const [path, x] of rows) {
    if (typeof path !== "string" || !x) continue;
    const full = path.startsWith("/nix/store/") ? path : `/nix/store/${path}`;
    out.set(full, { narSize: Number(x.narSize) || 0, references: (Array.isArray(x.references) ? x.references : []).filter((r: unknown) => typeof r === "string").map((r: string) => (r.startsWith("/nix/store/") ? r : `/nix/store/${r}`)) });
  }
  return out;
}

/** "git-2.47.0" -> name git, version 2.47.0; "xgcc-16.2.0-libgcc" -> xgcc, 16.2.0, output libgcc. Pure. */
export function splitName(path: string): { name: string; version: string; output: string } | null {
  const rest = STORE.exec(path)?.[1];
  if (!rest) return null;
  const m = /^(.+?)-(\d[\w.+~]*)(?:-(.+))?$/.exec(rest);
  return m ? { name: m[1], version: m[2], output: m[3] ?? "" } : { name: rest, version: "", output: "" };
}

const SKIP = new Set(["man", "info", "doc", "devdoc", "dev", "debug", "static"]);
const kindOf = (name: string): Kind =>
  /firmware|driver|mesa|pipewire|bluez|cups|alsa|wireplumber|udev|xorg/.test(name) ? "Driver"
  : /^lib|glibc|zlib|openssl|ncurses|readline|expat|gcc|musl|gnutls|pcre|icu|boost/.test(name) ? "Library"
  : /chromium|firefox|steam|vlc|gimp|libreoffice|inkscape|blender/.test(name) ? "App"
  : "Tool";

/** The system's packages and which of them need which, from the store graph. `top` are the store paths the system profile links. Pure. */
export function buildPackages(info: Info, top: string[]): Pkg[] {
  const topSet = new Set(top);
  const memo = new Map<string, Set<string>>(); // path -> the profile's packages reachable from it (not the whole closure: that is quadratic)
  const reach = (p: string): Set<string> => {
    const hit = memo.get(p);
    if (hit) return hit;
    const s = new Set<string>();
    memo.set(p, s); // a cycle just sees what is collected so far
    for (const r of info.get(p)?.references ?? []) if (r !== p) (topSet.has(r) && s.add(r), reach(r).forEach((x) => s.add(x)));
    return s;
  };
  const idOf = new Map<string, string>();
  const pkgs = new Map<string, Pkg>();
  for (const p of top) {
    const n = splitName(p);
    if (!n || SKIP.has(n.output)) continue;
    idOf.set(p, n.name);
    const size = Math.round(((info.get(p)?.narSize ?? 0) / 1e6) * 10) / 10;
    const had = pkgs.get(n.name);
    if (had) had.size = Math.round((had.size + size) * 10) / 10; // another output of the same package
    else pkgs.set(n.name, { id: n.name, name: n.name, kind: kindOf(n.name), version: n.version, size, summary: "", deps: [] });
  }
  for (const p of top) {
    const id = idOf.get(p);
    if (!id) continue;
    const deps = pkgs.get(id)!.deps;
    for (const d of reach(p)) {
      const did = idOf.get(d);
      if (did && did !== id && !deps.includes(did)) deps.push(did);
    }
  }
  for (const p of pkgs.values()) p.deps.sort();
  return [...pkgs.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const run = async (cmd: string[]): Promise<string | null> => {
  try {
    const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
    const out = await new Response(p.stdout).text();
    return (await p.exited) === 0 ? out : null;
  } catch {
    return null;
  }
};

export const createSlice = (_: unknown): Slice => {
  let cache: { at: number; pkgs: Pkg[] } | null = null; // the closure walk is the expensive part; the system does not change under us
  return {
    name: "packages",
    async handle(req, ctx) {
      if (ctx.target.kind !== "app" || ctx.target.id !== "packages" || ctx.url.pathname !== "/packages" || req.method !== "GET") return;
      const g = ctx.gate("packages.read"); // a same-origin GET carries no Origin: the gate identifies it by Sec-Fetch-Site
      if (!g.ok) return g.res;
      if (cache && Date.now() - cache.at < 60_000) return json({ packages: cache.pkgs, canChange: false });
      const nix = (process.env.BRASOS_NIX || "nix").split(" ").filter(Boolean);
      const given = process.env.BRASOS_NIX_ROOT; // a test names a store path that does not exist on disk
      let root = given || "/run/current-system/sw";
      try {
        root = realpathSync(root);
      } catch {
        if (!given) return json({ error: "this system has no Nix store to read" }, 501);
      }
      const out = (await run([...nix, "path-info", "--json", "-r", "--extra-experimental-features", "nix-command", root])) ?? (await run(["/run/current-system/sw/bin/nix", "path-info", "--json", "-r", "--extra-experimental-features", "nix-command", root]));
      if (out === null) return json({ error: "the package list could not be read" }, 501);
      const info = parsePathInfo(out);
      const top = (info.get(root)?.references ?? []).filter((r) => r !== root);
      if (!top.length) return json({ error: "the package list is empty" }, 501);
      cache = { at: Date.now(), pkgs: buildPackages(info, top) };
      return json({ packages: cache.pkgs, canChange: false });
    },
  };
};
