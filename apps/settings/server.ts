// The Settings app's server side: what this machine is (read from /proc, /sys and os-release; `settings.read`) and the few things
// it can change from here (volume and mute through PipeWire's wpctl, airplane mode through rfkill; `settings.write`, audited).
// Display changes are not applied: the compositor has no control for them yet, and the app says so. Where a source is missing
// (Windows, a VM without a sound server) the field is null and the page shows that, never invented values.
import { readdirSync, readFileSync, statfsSync } from "node:fs";
import { arch, cpus, hostname, networkInterfaces, release, totalmem, uptime } from "node:os";
import type { AuditFn, Slice } from "@brasos/host/types";
import { json } from "@brasos/host/types";
import { ACTIONS, createUpdates, type Action } from "./updates";

export type Device = { id: string; name: string; group: "Input" | "Audio" | "Graphics" | "Storage" | "Network"; detail: string; connected: boolean };
export type Driver = { id: string; name: string; device: string; version: string; kind: "Kernel module" | "Firmware" | "User space"; loaded: boolean };

const read = (p: string) => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
};
const ls = (p: string) => {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
};

/** PRETTY_NAME from /etc/os-release. Pure. */
export const parseOsRelease = (text: string) => /^PRETTY_NAME="?([^"\n]*)"?/m.exec(text)?.[1] ?? "";

/** /proc/bus/input/devices: one block per device with `N: Name="..."` and `H: Handlers=kbd event3`. Pure. */
export function parseInput(text: string): Device[] {
  return text.split(/\n\n+/).flatMap((b, i) => {
    const name = /^N: Name="(.*)"/m.exec(b)?.[1];
    if (!name) return [];
    const h = (/^H: Handlers=(.*)/m.exec(b)?.[1] ?? "").split(" ").filter(Boolean);
    const kind = h.includes("kbd") ? "keyboard" : h.some((x) => x.startsWith("mouse")) ? "pointer" : "input";
    return [{ id: `input${i}`, name, group: "Input" as const, detail: kind, connected: true }];
  });
}

/** /proc/modules: `name size refcount deps state address`. Pure. */
export function parseModules(text: string, kernel: string): Driver[] {
  return text.split("\n").filter(Boolean).map((l) => {
    const [name, , , deps] = l.split(" ");
    return { id: name, name, device: deps && deps !== "-" ? deps.replace(/,$/, "").split(",").join(", ") : "", version: kernel, kind: "Kernel module" as const, loaded: true };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** `wpctl get-volume` prints `Volume: 0.60` and `[MUTED]` when muted. Pure. */
export function parseVolume(out: string): { volume: number; muted: boolean } | null {
  const m = /Volume:\s*([\d.]+)/.exec(out);
  return m ? { volume: Math.round(Number(m[1]) * 100), muted: /\[MUTED\]/.test(out) } : null;
}

/** `rfkill list` blocks: airplane mode is on when every radio is soft-blocked. Pure. */
export function parseRfkill(out: string): boolean | null {
  const blocks = [...out.matchAll(/Soft blocked: (yes|no)/g)].map((m) => m[1] === "yes");
  return blocks.length ? blocks.every(Boolean) : null;
}

export type Snapshot = ReturnType<typeof snapshot>;

/** Everything Settings shows, read from `root` (the real "/" or a test's fake tree). */
export function snapshot(root = "/") {
  const sys = `${root}sys`, proc = `${root}proc`;
  const kernel = release();
  const devices: Device[] = parseInput(read(`${proc}/bus/input/devices`));
  const drm = ls(`${sys}/class/drm`).filter((d) => /^card\d+-/.test(d));
  const outputs = drm.map((d) => ({ name: d.replace(/^card\d+-/, ""), connected: read(`${sys}/class/drm/${d}/status`).trim() === "connected", modes: read(`${sys}/class/drm/${d}/modes`).split("\n").filter(Boolean) }));
  for (const o of outputs) devices.push({ id: `drm-${o.name}`, name: o.name, group: "Graphics", detail: o.modes[0] ? `${o.modes[0]} preferred` : "no mode", connected: o.connected });
  for (const d of ls(`${sys}/bus/pci/devices`)) {
    const cls = read(`${sys}/bus/pci/devices/${d}/class`).trim();
    const id = /^PCI_ID=(.*)/m.exec(read(`${sys}/bus/pci/devices/${d}/uevent`))?.[1] ?? "";
    if (cls.startsWith("0x0403") || cls.startsWith("0x0401")) devices.push({ id: `pci-${d}`, name: "Audio controller", group: "Audio", detail: `PCI ${id}`, connected: true });
  }
  for (const b of ls(`${sys}/block`).filter((x) => !/^(loop|ram|zram|sr|fd)/.test(x))) {
    const sectors = Number(read(`${sys}/block/${b}/size`).trim()) || 0;
    const model = read(`${sys}/block/${b}/device/model`).trim();
    devices.push({ id: `blk-${b}`, name: model || b, group: "Storage", detail: `${b} · ${Math.round((sectors * 512) / 1e8) / 10} GB`, connected: true });
  }
  for (const n of ls(`${sys}/class/net`).filter((x) => x !== "lo")) {
    devices.push({ id: `net-${n}`, name: n, group: "Network", detail: read(`${sys}/class/net/${n}/address`).trim(), connected: read(`${sys}/class/net/${n}/operstate`).trim() === "up" });
  }
  const modes = [...new Set(outputs.filter((o) => o.connected).flatMap((o) => o.modes))];
  let storage = { used: 0, total: 0 };
  try {
    const s = statfsSync(root);
    storage = { total: Math.round((s.blocks * s.bsize) / 1e8) / 10, used: Math.round(((s.blocks - s.bfree) * s.bsize) / 1e8) / 10 };
  } catch {}
  const c = cpus();
  const up = Math.round(uptime() / 60);
  const nets = Object.entries(networkInterfaces()).flatMap(([name, a]) => (a ?? []).filter((x) => !x.internal && x.family === "IPv4").map((x) => ({ name, ip: x.address })));
  return {
    info: [
      ["Device name", hostname()],
      ["System", parseOsRelease(read(`${root}etc/os-release`)) || "BrasOS"],
      ["Kernel", `${process.platform === "linux" ? "Linux" : process.platform} ${kernel}`],
      ["Architecture", arch()],
      ["Processor", `${c[0]?.model.trim() ?? "unknown"}, ${c.length} cores`],
      ["Memory", `${Math.round(totalmem() / 1e8) / 10} GB`],
      ["Uptime", up >= 60 ? `${Math.floor(up / 60)} h ${up % 60} min` : `${up} min`],
    ] as [string, string][],
    storage,
    devices,
    drivers: parseModules(read(`${proc}/modules`), kernel),
    display: outputs.some((o) => o.connected) ? { name: outputs.find((o) => o.connected)!.name, resolutions: modes, resolution: modes[0] ?? "" } : null,
    network: { adapter: nets[0]?.name ?? "", ip: nets[0]?.ip ?? "" },
  };
}

const run = async (cmd: string[]): Promise<string | null> => {
  try {
    const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
    const out = await new Response(p.stdout).text();
    return (await p.exited) === 0 ? out : null;
  } catch {
    return null; // not installed
  }
};
const SINK = "@DEFAULT_AUDIO_SINK@";

export const createSlice = ({ audit }: { audit: AuditFn }): Slice => {
  const updates = createUpdates(audit);
  return {
  name: "settings",
  async handle(req, ctx) {
    if (ctx.target.kind !== "app" || ctx.target.id !== "settings") return;
    const p = ctx.url.pathname;
    if (p === "/updates" || p === "/updates/run") {
      const g = ctx.gate("system.update", { sameOrigin: req.method !== "GET" }); // a page's own GET carries no Origin
      if (!g.ok) return g.res;
      if (p === "/updates" && req.method === "GET") return json(await updates.status());
      if (p === "/updates/run" && req.method === "POST") {
        if (!updates.enabled()) return json({ error: "this system cannot update itself" }, 501);
        if (updates.job.state === "running") return json({ error: "an update is already running" }, 409);
        const b = (await req.json().catch(() => null)) as { action?: unknown } | null;
        if (typeof b?.action !== "string" || !Object.hasOwn(ACTIONS, b.action)) return json({ error: "action: apply, rollback or rebuild" }, 400);
        updates.start(b.action as Action, "settings");
        return json(updates.job, 202);
      }
      return json({ error: "method not allowed" }, 405);
    }
    if (p === "/system" && req.method === "GET") {
      const g = ctx.gate("settings.read"); // a same-origin GET carries no Origin: the gate identifies it by Sec-Fetch-Site
      if (!g.ok) return g.res;
      const root = process.env.BRASOS_SYS_ROOT || "/";
      const [vol, rf] = [await run(["wpctl", "get-volume", SINK]), await run(["rfkill", "list"])];
      return json({ ...snapshot(root), sound: vol ? parseVolume(vol) : null, airplane: rf ? parseRfkill(rf) : null });
    }
    if ((p === "/sound" || p === "/airplane") && req.method === "POST") {
      const g = ctx.gate("settings.write", { sameOrigin: true });
      if (!g.ok) return g.res;
      const b = (await req.json().catch(() => null)) as { volume?: unknown; muted?: unknown; on?: unknown } | null;
      if (p === "/airplane") {
        if (typeof b?.on !== "boolean") return json({ error: "on: true or false" }, 400);
        if ((await run(["rfkill", b.on ? "block" : "unblock", "all"])) === null) return json({ error: "this system cannot switch radios from here" }, 501);
        audit("settings.airplane", "info", { app: "settings" }, { on: b.on });
        return json({ on: b.on });
      }
      const set: string[][] = [];
      if (b?.volume !== undefined) {
        if (typeof b.volume !== "number" || !Number.isFinite(b.volume) || b.volume < 0 || b.volume > 100) return json({ error: "volume: 0 to 100" }, 400);
        set.push(["wpctl", "set-volume", SINK, `${Math.round(b.volume)}%`]);
      }
      if (b?.muted !== undefined) {
        if (typeof b.muted !== "boolean") return json({ error: "muted: true or false" }, 400);
        set.push(["wpctl", "set-mute", SINK, b.muted ? "1" : "0"]);
      }
      if (!set.length) return json({ error: "nothing to change" }, 400);
      for (const c of set) if ((await run(c)) === null) return json({ error: "there is no sound server to talk to" }, 501);
      audit("settings.sound", "info", { app: "settings" }, { volume: b?.volume ?? null, muted: b?.muted ?? null });
      return json({ ok: true });
    }
    return;
  },
  };
};
