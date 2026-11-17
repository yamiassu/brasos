// System updates for the Settings app (dev image only): compare this system with the operator's manifest, and run `brasos-update`
// (check/apply/rollback/rebuild-from-the-on-device-flake). Gated by `system.update`, which the hardened package denies (default deny).
// The manifest URL is set by the image (BRASOS_UPDATE_URL), never by a page or the user, so this is not a user-supplied fetch (contract 7);
// the privileged work is done by the root script `brasos-update`, which re-fetches and validates the manifest itself: nothing the page
// or this process read is ever passed to it. Every decision and the start/end of a job are audited; the command's output never is.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditFn } from "@brasos/host/types";

export type Manifest = { version: string; notes: string; flake: string };
/** what the running job is doing, read from the updater's output (Nix prints what it fetches and builds): a step, a count, and when it last said anything */
export type Progress = { step: string; detail: string; fetched: number; fetchTotal: number; built: number; buildTotal: number; started: number; last: number };
export type Job = { state: "idle" | "running" | "done" | "failed"; action: string; log: string; progress: Progress };
const fresh = (step = ""): Progress => ({ step, detail: "", fetched: 0, fetchTotal: 0, built: 0, buildTotal: 0, started: Date.now(), last: Date.now() });
const nameOf = (p: string) => p.replace(/^.*\/[a-z0-9]{32}-/, "").replace(/\.drv$/, "").slice(0, 60);

/** Updates the progress from one line of the updater's output. Pure apart from `p`. */
export function feed(p: Progress, line: string) {
  p.last = Date.now();
  let m: RegExpExecArray | null;
  if ((m = /these (\d+) derivations? will be built/.exec(line))) p.buildTotal = Number(m[1]);
  else if ((m = /these (\d+) paths? will be fetched/.exec(line))) p.fetchTotal = Number(m[1]);
  else if ((m = /^copying path '([^']*)'/.exec(line))) (p.step = "Downloading", p.detail = nameOf(m[1]), p.fetched++);
  else if ((m = /^building '([^']*)'/.exec(line))) (p.step = "Building", p.detail = nameOf(m[1]), p.built++);
  else if (/activating the configuration|switching to system configuration|setting up tmpfiles|reloading user units|restarting the|updating GRUB|installing the boot loader/i.test(line)) (p.step = "Switching to the new system", p.detail = "");
  else if (/removing generation|deleting '|store paths deleted|collecting garbage|deleting garbage|cleaning up old/i.test(line)) (p.step = "Cleaning up old versions", p.detail = "");
}
const MAX_LOG = 20_000;
const VERSION = /^[A-Za-z0-9._-]{1,40}$/;
const FLAKE = /^https:\/\/[A-Za-z0-9._~:/?#=&%+-]{1,400}$/;

/** Reads and validates the manifest `{version, flake, notes?}`; null if it is not one. Pure. */
export function parseManifest(text: string): Manifest | null {
  let v: any;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!v || typeof v.version !== "string" || !VERSION.test(v.version) || typeof v.flake !== "string" || !FLAKE.test(v.flake)) return null;
  return { version: v.version, flake: v.flake, notes: typeof v.notes === "string" ? v.notes.slice(0, 500) : "" };
}

/** the store hash of a /nix/store path, shortened (what identifies a build); "" for anything else */
const buildOf = (p: string) => /^\/nix\/store\/([a-z0-9]{32})-/.exec(p.trim())?.[1].slice(0, 8) ?? "";

/**
 * Which build the interface on screen was made from, against the build of the running system. The live copy of the interface
 * (BRASOS_LIVE) is seeded from the system's source (BRASOS_SRC) and stamped; after an update it is replaced only if it was never
 * edited, so "older" means the copy still comes from an earlier build (edited, or the interface has not restarted since).
 * null where the image sets neither (a plain run, the hardened package).
 */
export function interfaceBuild(env: Record<string, string | undefined> = process.env) {
  const system = buildOf(env.BRASOS_SRC ?? ""), live = env.BRASOS_LIVE;
  if (!system || !live) return null;
  let stamp: string | null = null;
  try {
    stamp = readFileSync(join(live, ".brasos-seed"), "utf8").split("\n")[1] ?? "";
  } catch {}
  const from = stamp === null ? "" : buildOf(stamp);
  return { system, from, state: stamp === null ? "unstamped" : from === system ? "current" : "older" } as const;
}

export const ACTIONS = { apply: [], rollback: ["--rollback"], rebuild: ["--local"] } as const;
export type Action = keyof typeof ACTIONS;

export function createUpdates(audit: AuditFn) {
  const job: Job = { state: "idle", action: "", log: "", progress: fresh() };
  const cmd = () => (process.env.BRASOS_UPDATE_CMD ?? "").split(" ").filter(Boolean);
  const current = () => process.env.BRASOS_VERSION ?? "";

  /** What this system is and what the operator offers; the fetch is bounded (time, size) and only ever to the image's own URL. */
  async function status() {
    const url = process.env.BRASOS_UPDATE_URL ?? "";
    const base = { enabled: cmd().length > 0, current: current(), url: url ? new URL(url).host : "", job, interface: interfaceBuild(), latest: null as Manifest | null, available: false, error: "" };
    if (!url) return base;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: "error" });
      const text = r.ok ? await r.text() : "";
      const m = text.length < 65536 ? parseManifest(text) : null;
      if (!m) return { ...base, error: r.ok ? "the update server sent something that is not an update manifest" : `the update server answered ${r.status}` };
      return { ...base, latest: m, available: m.version !== current() };
    } catch {
      return { ...base, error: "the update server could not be reached" };
    }
  }

  function start(action: Action, by: string) {
    Object.assign(job, { state: "running", action, log: "", progress: fresh(action === "rollback" ? "Going back to the previous version" : "Preparing: fetching the update and working out what changed (this can take a few minutes with no output)") });
    audit("system.update.start", "info", { app: by }, { action });
    const p = Bun.spawn([...cmd(), ...ACTIONS[action]], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const pump = async (s: ReadableStream<Uint8Array>) => {
      let rest = "";
      const dec = new TextDecoder();
      for await (const c of s) {
        const text = dec.decode(c, { stream: true });
        job.log = (job.log + text).slice(-MAX_LOG);
        const lines = (rest + text).split(/\r?\n/);
        rest = lines.pop() ?? "";
        for (const l of lines) feed(job.progress, l);
      }
    };
    void Promise.all([pump(p.stdout), pump(p.stderr), p.exited]).then(() => {
      job.state = p.exitCode === 0 ? "done" : "failed";
      audit("system.update.finish", job.state === "done" ? "info" : "warn", { app: by }, { action, exit: p.exitCode });
    });
  }
  return { status, start, job, enabled: () => cmd().length > 0 };
}
