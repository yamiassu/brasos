// The Task Manager's server side: what is running on this machine (read from /proc on Linux; elsewhere only the host itself and
// the machine totals) and ending it. Reading needs `processes.read`; ending needs `processes.end`, and only on the app's own
// origin. The client never names a pid: it names a group from the last list and the server looks the pids up again, so only
// processes of the user the host runs as can be signalled, never the host itself. Every end is audited (name and count).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { cpus, freemem, totalmem } from "node:os";
import type { AuditFn, Slice } from "@brasos/host/types";
import { json } from "@brasos/host/types";

export type RawProc = { pid: number; comm: string; uid: number; ticks: number; rssKB: number };
export type Machine = { procs: RawProc[]; cpuTotal: number; cpuIdle: number; memTotalKB: number; memAvailKB: number };
export type Group = { id: string; name: string; icon: string; kind: "app" | "system"; state: "running"; cpu: number; mem: number; count: number };

const num = (s: string | undefined) => Number(s) || 0;

/** /proc/<pid>/stat: the name is in parentheses and may hold spaces, so split after the last ")". Pure. */
export function parseStat(text: string): { comm: string; ticks: number; rssPages: number } | null {
  const a = text.indexOf("("), b = text.lastIndexOf(")");
  if (a < 0 || b < a) return null;
  const f = text.slice(b + 2).split(" "); // f[0] is field 3 (state)
  return { comm: text.slice(a + 1, b), ticks: num(f[11]) + num(f[12]), rssPages: num(f[21]) };
}

/** `cpu user nice system idle iowait ...` -> total and idle jiffies. Pure. */
export function parseCpu(text: string): { total: number; idle: number } {
  const v = (text.split("\n")[0] ?? "").trim().split(/\s+/).slice(1).map(Number);
  return { total: v.reduce((a, x) => a + (x || 0), 0), idle: (v[3] || 0) + (v[4] || 0) };
}

export function parseMem(text: string): { totalKB: number; availKB: number } {
  const get = (k: string) => num(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(text)?.[1]);
  return { totalKB: get("MemTotal"), availKB: get("MemAvailable") };
}

/** Reads the machine. `root` is /proc (a test points it at a fake one). Without it (Windows, macOS) only the host and the totals. */
export function readMachine(root = "/proc"): Machine {
  try {
    const cpu = parseCpu(readFileSync(`${root}/stat`, "utf8"));
    const mem = parseMem(readFileSync(`${root}/meminfo`, "utf8"));
    const procs: RawProc[] = [];
    for (const d of readdirSync(root)) {
      if (!/^\d+$/.test(d)) continue;
      try {
        const s = parseStat(readFileSync(`${root}/${d}/stat`, "utf8"));
        if (s) procs.push({ pid: +d, comm: s.comm, uid: statSync(`${root}/${d}`).uid, ticks: s.ticks, rssKB: s.rssPages * 4 });
      } catch {} // it exited while we were reading
    }
    return { procs, cpuTotal: cpu.total, cpuIdle: cpu.idle, memTotalKB: mem.totalKB, memAvailKB: mem.availKB };
  } catch {
    const c = cpus();
    const idle = c.reduce((a, x) => a + x.times.idle, 0), total = c.reduce((a, x) => a + x.times.user + x.times.nice + x.times.sys + x.times.idle + x.times.irq, 0);
    return { procs: [{ pid: process.pid, comm: "bun", uid: process.getuid?.() ?? 0, ticks: 0, rssKB: Math.round(process.memoryUsage.rss() / 1024) }], cpuTotal: total, cpuIdle: idle, memTotalKB: Math.round(totalmem() / 1024), memAvailKB: Math.round(freemem() / 1024) };
  }
}

const KNOWN: Record<string, { name: string; icon: string; kind: "app" | "system" }> = {
  bun: { name: "BrasOS host", icon: "dev", kind: "system" },
  chromium: { name: "Windows and apps (Chromium)", icon: "browser", kind: "app" },
  ".chromium-wrapp": { name: "Windows and apps (Chromium)", icon: "browser", kind: "app" },
  chrome: { name: "Windows and apps (Chromium)", icon: "browser", kind: "app" },
  cage: { name: "Display (cage)", icon: "display", kind: "system" },
  "brasos-compositor": { name: "Compositor", icon: "display", kind: "system" },
  systemd: { name: "systemd", icon: "chip", kind: "system" },
  Xwayland: { name: "X11 apps (Xwayland)", icon: "display", kind: "system" },
  bash: { name: "Terminal shells", icon: "terminal", kind: "app" },
};

/** Groups processes by executable and turns tick deltas into percent of the whole machine. Pure, so it is tested without a machine. */
export function groupProcs(m: Machine, prevTicks: Map<number, number>, dTotal: number, hostUid: number): Group[] {
  const by = new Map<string, Group>();
  for (const p of m.procs) {
    const k = KNOWN[p.comm];
    const g = by.get(p.comm) ?? { id: p.comm, name: k?.name ?? p.comm, icon: k?.icon ?? (p.uid === hostUid ? "app" : "chip"), kind: k?.kind ?? (p.uid === hostUid && p.uid !== 0 ? "app" : "system"), state: "running" as const, cpu: 0, mem: 0, count: 0 };
    const before = prevTicks.get(p.pid);
    if (before !== undefined && dTotal > 0) g.cpu += Math.max(0, ((p.ticks - before) / dTotal) * 100);
    g.mem += p.rssKB / 1024;
    g.count++;
    by.set(p.comm, g);
  }
  return [...by.values()].map((g) => ({ ...g, cpu: Math.round(g.cpu * 10) / 10, mem: Math.round(g.mem) }));
}

export const createSlice = ({ audit }: { audit: AuditFn }): Slice => {
  const root = process.env.BRASOS_PROC_ROOT || "/proc";
  let prev = { ticks: new Map<number, number>(), total: 0, idle: 0 };
  const hostUid = process.getuid?.() ?? -1;

  const sample = () => {
    const m = readMachine(root);
    const dTotal = m.cpuTotal - prev.total;
    const groups = groupProcs(m, prev.ticks, prev.total ? dTotal : 0, hostUid);
    const busy = prev.total && dTotal > 0 ? (1 - (m.cpuIdle - prev.idle) / dTotal) * 100 : 0;
    prev = { ticks: new Map(m.procs.map((p) => [p.pid, p.ticks])), total: m.cpuTotal, idle: m.cpuIdle };
    const memTotal = Math.round(m.memTotalKB / 1024);
    return { procs: groups, cpu: Math.round(busy * 10) / 10, memTotal, memUsed: memTotal - Math.round(m.memAvailKB / 1024), sample: false };
  };

  return {
    name: "task-manager",
    async handle(req, ctx) {
      if (ctx.target.kind !== "app" || ctx.target.id !== "task-manager") return;
      const p = ctx.url.pathname;
      if (p === "/processes" && req.method === "GET") {
        const g = ctx.gate("processes.read"); // a same-origin GET carries no Origin: the gate identifies it by Sec-Fetch-Site
        return g.ok ? json(sample()) : g.res;
      }
      if (p === "/end" && req.method === "POST") {
        const g = ctx.gate("processes.end", { sameOrigin: true });
        if (!g.ok) return g.res;
        const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
        const id = typeof body?.id === "string" ? body.id : "";
        const m = readMachine(root);
        const mine = m.procs.filter((x) => x.comm === id);
        if (!id || !mine.length) return json({ error: "not running" }, 404);
        if (mine.some((x) => x.pid === process.pid || x.pid === 1)) return json({ error: "this is the system's own process and cannot be ended" }, 403);
        const own = mine.filter((x) => x.uid === hostUid);
        if (!own.length) return json({ error: "belongs to another user" }, 403);
        let ended = 0;
        for (const x of own) {
          try {
            process.kill(x.pid, "SIGTERM");
            ended++;
          } catch {}
        }
        audit("processes.end", "warn", { app: "task-manager" }, { name: id, count: ended });
        return json({ ended });
      }
      return;
    },
  };
};
