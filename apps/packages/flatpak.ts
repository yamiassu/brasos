// Apps from Flathub for the Packages app (dev image only): search, install and remove Flatpak apps for the user the host runs as.
// Reading (the installed list, a search) is `packages.read`; install and remove are `packages.install`, which only this app holds (never
// grantable to a PWA, absent from the shell's and agents' sets, denied by the hardened package: default deny). The tool and its remote
// are the image's: BRASOS_FLATPAK names the binary, the Flathub address is fixed here, and a request supplies only a search text or an
// application id that passed the same rule the compositor applies when it starts the app. One job at a time; start and finish are
// audited (action and application id, never the tool's output).
import { json, type AuditFn, type Slice } from "@brasos/host/types";
import { listFlatpaks, safeAppId } from "@brasos/native";

const FLATHUB = "https://dl.flathub.org/repo/flathub.flatpakrepo";
const MAX_LOG = 20_000;
export type Job = { state: "idle" | "running" | "done" | "failed"; action: string; id: string; log: string; percent: number | null; started: number; last: number };
export type Found = { id: string; name: string; summary: string };

/** A search text: letters, digits, spaces and a little punctuation, bounded. Pure. */
export const safeQuery = (q: unknown): q is string => typeof q === "string" && /^[\p{L}\p{N} ._+-]{1,60}$/u.test(q);

/** `flatpak search --columns=application,name,description`: tab-separated rows. Pure. */
export function parseSearch(text: string): Found[] {
  return text
    .split("\n")
    .map((l) => l.split("\t"))
    .filter((c) => safeAppId(c[0]?.trim()))
    .slice(0, 40)
    .map((c) => ({ id: c[0].trim(), name: (c[1] || c[0]).trim().slice(0, 80), summary: (c[2] ?? "").trim().slice(0, 200) }));
}

/** The last percentage the tool printed ("Installing… 45%"), or null. Pure. */
export function percentOf(text: string): number | null {
  const all = [...text.matchAll(/(\d{1,3})%/g)];
  const n = all.length ? Number(all[all.length - 1][1]) : NaN;
  return n >= 0 && n <= 100 ? n : null;
}

export function createFlatpak(audit: AuditFn) {
  const bin = () => (process.env.BRASOS_FLATPAK ?? "").split(" ").filter(Boolean);
  const job: Job = { state: "idle", action: "", id: "", log: "", percent: null, started: 0, last: 0 };
  let remote = false;

  const run = async (args: string[], timeout = 30_000): Promise<string | null> => {
    try {
      const p = Bun.spawn([...bin(), ...args], { stdout: "pipe", stderr: "ignore", stdin: "ignore", timeout });
      const out = await new Response(p.stdout).text();
      return (await p.exited) === 0 ? out : null;
    } catch {
      return null;
    }
  };
  /** Flathub is added to this user's installation once (the user remote: a system remote can't be installed from by a user installation) */
  const ensureRemote = async () => remote || (remote = (await run(["remote-add", "--user", "--if-not-exists", "flathub", FLATHUB])) !== null);

  function start(action: "install" | "remove", id: string, by: string) {
    Object.assign(job, { state: "running", action, id, log: "", percent: null, started: Date.now(), last: Date.now() });
    audit("packages.install.start", "info", { app: by }, { action, id });
    void (async () => {
      let code = 1;
      try {
        if (action === "install" && !(await ensureRemote())) throw new Error("could not add Flathub");
        const args = action === "install" ? ["install", "--user", "-y", "--noninteractive", "flathub", id] : ["uninstall", "--user", "-y", "--noninteractive", id];
        const p = Bun.spawn([...bin(), ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
        const pump = async (s: ReadableStream<Uint8Array>) => {
          const dec = new TextDecoder();
          for await (const c of s) {
            job.log = (job.log + dec.decode(c, { stream: true })).slice(-MAX_LOG);
            job.last = Date.now();
            job.percent = percentOf(job.log.slice(-400)) ?? job.percent;
          }
        };
        await Promise.all([pump(p.stdout), pump(p.stderr), p.exited]);
        code = p.exitCode ?? 1;
      } catch (e) {
        job.log += `\n${(e as Error).message}`;
      }
      job.state = code === 0 ? "done" : "failed";
      if (code === 0) job.percent = 100;
      audit("packages.install.finish", code === 0 ? "info" : "warn", { app: by }, { action, id, exit: code });
    })();
  }

  const slice = async (req: Request, ctx: Parameters<Slice["handle"]>[1]) => {
    const p = ctx.url.pathname;
    if (!bin().length) return json({ available: false, installed: [], job }, p === "/flatpak" ? 200 : 501);
    if (req.method === "GET" && p === "/flatpak") {
      const g = ctx.gate("packages.read");
      return g.ok ? json({ available: true, installed: await listFlatpaks(), job }) : g.res;
    }
    if (req.method === "GET" && p === "/flatpak/search") {
      const g = ctx.gate("packages.read");
      if (!g.ok) return g.res;
      const q = ctx.url.searchParams.get("q");
      if (!safeQuery(q)) return json({ error: "search for 1 to 60 letters, digits or spaces" }, 400);
      await ensureRemote();
      const out = await run(["search", "--user", "--columns=application,name,description", q], 60_000);
      return out === null ? json({ error: "the app store could not be searched (is this computer online?)" }, 502) : json({ results: parseSearch(out) });
    }
    if (req.method === "POST" && (p === "/flatpak/install" || p === "/flatpak/remove")) {
      const g = ctx.gate("packages.install", { sameOrigin: true });
      if (!g.ok) return g.res;
      const id = ((await req.json().catch(() => null)) as any)?.id;
      if (!safeAppId(id)) return json({ error: "that is not an application id" }, 400);
      if (job.state === "running") return json({ error: "another install or removal is running" }, 409);
      if (p === "/flatpak/remove" && !(await listFlatpaks()).some((f) => f.id === id)) return json({ error: "that app is not installed" }, 404);
      start(p === "/flatpak/install" ? "install" : "remove", id, ctx.target.kind === "app" ? ctx.target.id : "");
      return json(job, 202);
    }
  };
  return slice;
}
