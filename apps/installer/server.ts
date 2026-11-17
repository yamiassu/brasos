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
  const run = (disk: string, swapGB: number) => {
    Object.assign(job, { state: "running", disk, log: "", phase: 0, percent: 0 });
    audit("installer.start", "info", { app: "installer" }, { disk, swapGB });
    const p = Bun.spawn([...cmd(), "--yes", ...(swapGB ? ["--swap", String(swapGB)] : []), disk], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
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
      if (!["/disks", "/status", "/install", "/reboot"].includes(p)) return;
      // a same-origin GET carries no Origin header (the gate identifies it by Sec-Fetch-Site), so sameOrigin is for the POSTs
      const g = ctx.gate("installer.run", { sameOrigin: req.method !== "GET" });
      if (!g.ok) return g.res;
      if (!cmd().length) return json({ error: "this system has no installer: boot the BrasOS install image" }, 501);
      if (p === "/disks" && req.method === "GET") {
        const d = await disks();
        return d ? json({ disks: d }) : json({ error: "this system could not list its disks (lsblk is not available)" }, 500);
      }
      if (p === "/status" && req.method === "GET") return json(job);
      if (p === "/reboot" && req.method === "POST") {
        if (job.state !== "done") return json({ error: "nothing was installed" }, 409);
        audit("installer.reboot", "info", { app: "installer" });
        const power = (process.env.BRASOS_POWER_CMD ?? "/run/wrappers/bin/sudo systemctl").split(" ").filter(Boolean); // full paths: the service has a minimal PATH
        setTimeout(() => Bun.spawn([...power, "reboot"], { stdio: ["ignore", "ignore", "ignore"] }), 300);
        return json({ rebooting: true }, 202);
      }
      if (p === "/install" && req.method === "POST") {
        if (job.state === "running") return json({ error: "an install is already running" }, 409);
        const body = (await req.json().catch(() => null)) as { disk?: unknown; swapGB?: unknown } | null;
        const disk = typeof body?.disk === "string" ? body.disk : "";
        const swap = body?.swapGB === undefined ? 0 : body.swapGB;
        if (!Number.isInteger(swap) || (swap as number) < 0 || (swap as number) > 64) return json({ error: "swap: whole GB, 0 to 64" }, 400);
        // only a disk that is listed now (whole, unmounted) can be erased, whatever the page sent
        if (!DISK.test(disk) || !(await disks())?.some((d) => d.path === disk)) return json({ error: "not an installable disk" }, 400);
        run(disk, swap as number);
        return json(job, 202);
      }
      return json({ error: "method not allowed" }, 405);
    },
  };
};
