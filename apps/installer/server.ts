// The installer app's server side: list the disks and run `brasos-install` on one. It erases a disk, so it exists only where the
// image says so (BRASOS_INSTALLER_CMD, set on the live ISO) and only for an app holding `installer.run` on its own origin.
// The hardened package denies the capability. Every decision and the start/end of an install are audited (never the output).
import type { AuditFn, Slice } from "@brasos/host/types";
import { json } from "@brasos/host/types";

export type Part = { label: string; sizeGB: number; fs: string; kind: string }; // kind: the partition type name ("Microsoft basic data", "EFI System"...)
export type Disk = { path: string; size: number; model: string; removable: boolean; rotational: boolean; parts: Part[] };
const DISK = /^\/dev\/[a-z0-9]+$/; // sda, vdb, nvme0n1: never a path with anything else in it

type Node = { path?: string; size?: number | string; model?: string | null; type?: string; rm?: boolean | string | number; rota?: boolean | string | number; fstype?: string | null; label?: string | null; parttypename?: string | null; mountpoints?: (string | null)[]; children?: Node[] };
const flag = (v: unknown) => v === true || v === "1" || v === 1;
const mounted = (n: Node): boolean => !!n.mountpoints?.some(Boolean) || !!n.children?.some(mounted);

// NAME must stay in the column list: without it lsblk prints a flat list and the partitions are never nested under their disk (every disk looked empty).
/** the whole disks from `lsblk -J` that nothing is mounted from (so never the stick we booted from). Pure, so it is tested without a machine. */
export function parseDisks(out: string): Disk[] {
  let tree: Node[];
  try {
    tree = JSON.parse(out).blockdevices ?? [];
  } catch {
    return [];
  }
  return tree
    .filter((n) => n.type === "disk" && typeof n.path === "string" && DISK.test(n.path) && !mounted(n))
    .map((n) => ({
      path: n.path!, size: Number(n.size) || 0, model: (n.model ?? "").trim(), removable: flag(n.rm), rotational: flag(n.rota),
      parts: (n.children ?? []).filter((c) => c.type === "part").map((c) => ({ label: (c.label ?? "").trim() || (c.fstype ?? "") || "Partition", sizeGB: Math.round((Number(c.size) || 0) / 1e8) / 10, fs: c.fstype ?? "", kind: c.parttypename ?? "" })),
    }));
}

export type Wifi = { ssid: string; signal: number; secure: boolean; active: boolean };
/** one line of `nmcli -t`: fields split on colons, `\:` and `\\` being literal */
export const splitTerse = (line: string): string[] => {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\" && i + 1 < line.length) cur += line[++i];
    else if (line[i] === ":") (out.push(cur), (cur = ""));
    else cur += line[i];
  }
  return [...out, cur];
};
/** `nmcli -t -f ACTIVE,SSID,SIGNAL,SECURITY dev wifi list`: strongest entry per network name, the connected one first */
export function parseWifi(out: string): Wifi[] {
  const best = new Map<string, Wifi>();
  for (const l of out.split(/\r?\n/)) {
    const [active, ssid, signal, security] = splitTerse(l);
    if (!ssid) continue;
    const w = { ssid, signal: Number(signal) || 0, secure: !!security && security !== "--", active: active === "yes" };
    const o = best.get(ssid);
    if (!o || w.active || (!o.active && w.signal > o.signal)) best.set(ssid, w);
  }
  return [...best.values()].sort((a, b) => +b.active - +a.active || b.signal - a.signal);
}
/** `nmcli -t -f TYPE,STATE dev`: is any real network device connected (not loopback)? */
export const parseConnected = (out: string) => out.split(/\r?\n/).some((l) => { const [t, s] = splitTerse(l); return !!t && t !== "loopback" && s === "connected"; });
/** a network name (1–32 bytes, no control characters, never an option) and a Wi-Fi password (empty, 8–63 characters or 64 hex digits) */
export const validWifi = (ssid: unknown, pass: unknown) =>
  typeof ssid === "string" && typeof pass === "string" && ssid.length > 0 && new TextEncoder().encode(ssid).length <= 32 && !ssid.startsWith("-") && !/[\x00-\x1f\x7f]/.test(ssid) &&
  !/[\x00-\x1f\x7f]/.test(pass) && (pass === "" || (pass.length >= 8 && pass.length <= 63) || /^[0-9a-fA-F]{64}$/.test(pass));

type Job = { state: "idle" | "running" | "done" | "failed"; disk: string; log: string; phase: number; percent: number };
const MAX_LOG = 20_000;

/** Reads the install's output line by line: `@phase N` and `@total N` markers from brasos-install, and nixos-install's "copying path" lines. Pure. */
export function progress(line: string, st: { phase: number; total: number; copied: number }): number {
  const m = /^@(phase|total) (\d+)/.exec(line);
  if (m) st[m[1] as "phase" | "total"] = +m[2];
  else if (/^copying path /.test(line)) st.copied++;
  else if (/boot ?loader|bootctl/i.test(line) && st.phase === 2) st.phase = 3;
  // partition 0-5, format 5-15, copy 15-85, bootloader 85-95, finish 95-100
  const base = [0, 5, 15, 85, 95][st.phase] ?? 95, next = [5, 15, 85, 95, 100][st.phase] ?? 100;
  const within = st.phase === 2 && st.total ? Math.min(1, st.copied / st.total) : 0;
  return Math.round(base + (next - base) * within);
}

export const createSlice = ({ audit }: { audit: AuditFn }): Slice => {
  const job: Job = { state: "idle", disk: "", log: "", phase: 0, percent: 0 };
  const cmd = () => (process.env.BRASOS_INSTALLER_CMD ?? "").split(" ").filter(Boolean);
  const lsblk = () => (process.env.BRASOS_INSTALLER_LSBLK ?? "lsblk -J -b -o NAME,PATH,SIZE,MODEL,TYPE,RM,ROTA,FSTYPE,LABEL,PARTTYPENAME,MOUNTPOINTS").split(" ").filter(Boolean);
  // a missing program must be an answer, not a crash: the page shows it
  const disks = async () => {
    try {
      return parseDisks(await new Response(Bun.spawn(lsblk(), { stdout: "pipe", stderr: "ignore" }).stdout).text());
    } catch {
      return null;
    }
  };
  // the image names nmcli and the update manifest; a page supplies only a network name and its password
  const nmcli = () => (process.env.BRASOS_INSTALLER_NMCLI ?? "").split(" ").filter(Boolean);
  const text = async (argv: string[]) => { const p = Bun.spawn(argv, { stdout: "pipe", stderr: "ignore", stdin: "ignore" }); const t = await new Response(p.stdout).text(); await p.exited; return p.exitCode === 0 ? t : ""; };
  const latest = async () => {
    const url = process.env.BRASOS_INSTALLER_LATEST_URL ?? "";
    if (!url) return null;
    try {
      const m = (await (await fetch(url, { signal: AbortSignal.timeout(5000) })).json()) as { version?: unknown; notes?: unknown };
      return typeof m.version === "string" ? { version: m.version.slice(0, 80), notes: typeof m.notes === "string" ? m.notes.slice(0, 300) : "" } : null;
    } catch {
      return null;
    }
  };
  const run = (disk: string, swapGB: number, wantLatest: boolean) => {
    Object.assign(job, { state: "running", disk, log: "", phase: 0, percent: 0 });
    audit("installer.start", "info", { app: "installer" }, { disk, swapGB, latest: wantLatest });
    const p = Bun.spawn([...cmd(), "--yes", ...(swapGB ? ["--swap", String(swapGB)] : []), ...(wantLatest ? ["--latest"] : []), disk], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const st = { phase: 0, total: 0, copied: 0 };
    const pump = async (s: ReadableStream<Uint8Array>) => {
      let rest = "";
      for await (const c of s) {
        const text = new TextDecoder().decode(c);
        job.log = (job.log + text).slice(-MAX_LOG);
        const lines = (rest + text).split("\n");
        rest = lines.pop() ?? "";
        for (const l of lines) (job.percent = progress(l, st), (job.phase = st.phase));
      }
    };
    void Promise.all([pump(p.stdout), pump(p.stderr), p.exited]).then(() => {
      job.state = p.exitCode === 0 ? "done" : "failed";
      if (job.state === "done") Object.assign(job, { phase: 4, percent: 100 });
      audit("installer.finish", job.state === "done" ? "info" : "warn", { app: "installer" }, { disk, exit: p.exitCode });
    });
  };
  return {
    name: "installer",
    async handle(req, ctx) {
      if (ctx.target.kind !== "app" || ctx.target.id !== "installer") return;
      const p = ctx.url.pathname;
      if (!["/disks", "/status", "/install", "/reboot", "/network", "/network/connect"].includes(p)) return;
      // a same-origin GET carries no Origin header (the gate identifies it by Sec-Fetch-Site), so sameOrigin is for the POSTs
      const g = ctx.gate("installer.run", { sameOrigin: req.method !== "GET" });
      if (!g.ok) return g.res;
      if (!cmd().length) return json({ error: "this system has no installer: boot the BrasOS install image" }, 501);
      if (p === "/disks" && req.method === "GET") {
        const d = await disks();
        return d ? json({ disks: d }) : json({ error: "this system could not list its disks (lsblk is not available)" }, 500);
      }
      if (p === "/status" && req.method === "GET") return json(job);
      if (p === "/network" && req.method === "GET") {
        if (!nmcli().length) return json({ available: false, connected: false, wifi: [], latest: null });
        const connected = parseConnected(await text([...nmcli(), "-t", "-f", "TYPE,STATE", "dev"]));
        const wifi = parseWifi(await text([...nmcli(), "-t", "-f", "ACTIVE,SSID,SIGNAL,SECURITY", "dev", "wifi", "list"]));
        return json({ available: true, connected, wifi, latest: connected ? await latest() : null });
      }
      if (p === "/network/connect" && req.method === "POST") {
        const body = (await req.json().catch(() => null)) as { ssid?: unknown; password?: unknown } | null;
        const password = body?.password === undefined ? "" : body.password;
        if (!nmcli().length) return json({ error: "this system cannot manage networks" }, 501);
        if (!validWifi(body?.ssid, password)) return json({ error: "that network name or password is not valid (a password is 8 to 63 characters)" }, 400);
        // the password goes on nmcli's command line for the few seconds it takes: this is the live install image, one user, never the installed system
        const c = Bun.spawn([...nmcli(), "--wait", "30", "dev", "wifi", "connect", body!.ssid as string, ...(password ? ["password", password as string] : [])], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
        const [out, err] = await Promise.all([new Response(c.stdout).text(), new Response(c.stderr).text(), c.exited]);
        audit("installer.network", c.exitCode === 0 ? "info" : "warn", { app: "installer" }, { ok: c.exitCode === 0 }); // never the name or the password
        if (c.exitCode === 0) return json({ ok: true });
        return json({ error: (err || out).split((password as string) || "\u0000").join("…").trim().split("\n")[0].slice(0, 200) || "could not connect" }, 400);
      }
      if (p === "/reboot" && req.method === "POST") {
        if (job.state !== "done") return json({ error: "nothing was installed" }, 409);
        audit("installer.reboot", "info", { app: "installer" });
        const power = (process.env.BRASOS_POWER_CMD ?? "/run/wrappers/bin/sudo systemctl").split(" ").filter(Boolean); // full paths: the service has a minimal PATH
        setTimeout(() => Bun.spawn([...power, "reboot"], { stdio: ["ignore", "ignore", "ignore"] }), 300);
        return json({ rebooting: true }, 202);
      }
      if (p === "/install" && req.method === "POST") {
        if (job.state === "running") return json({ error: "an install is already running" }, 409);
        const body = (await req.json().catch(() => null)) as { disk?: unknown; swapGB?: unknown; latest?: unknown } | null;
        const disk = typeof body?.disk === "string" ? body.disk : "";
        const swap = body?.swapGB === undefined ? 0 : body.swapGB;
        if (!Number.isInteger(swap) || (swap as number) < 0 || (swap as number) > 64) return json({ error: "swap: whole GB, 0 to 64" }, 400);
        // only a disk that is listed now (whole, unmounted) can be erased, whatever the page sent
        if (!DISK.test(disk) || !(await disks())?.some((d) => d.path === disk)) return json({ error: "not an installable disk" }, 400);
        run(disk, swap as number, body?.latest === true);
        return json(job, 202);
      }
      return json({ error: "method not allowed" }, 405);
    },
  };
};
