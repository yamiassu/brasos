// The Install BrasOS app: the shell's installer screens (drive, layout, review with a typed confirmation, progress) on the real
// backend in server.ts. It lists the disks the machine reports, starts `brasos-install` and follows its progress; where the image
// has no installer (501) it says so instead of showing drives that could not be installed on.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { os } from "@brasos/sdk";
import "@brasos/ui/ui.css";
import "../../packages/shell/src/shell.css";
import { Network } from "./network";
import { OsInstall } from "../../packages/shell/src/os-install";
import type { Disk as UiDisk, Plan } from "../../packages/shell/src/os-install-model";

type ServerDisk = { path: string; size: number; model: string; removable: boolean; rotational: boolean; parts: { label: string; sizeGB: number; fs: string }[] };
type Status = { state: "idle" | "running" | "done" | "failed"; log: string; phase: number; percent: number };

/** the server's disk as the screens draw it; nothing mounted is ever listed, so the stick we booted from never appears */
export const toUiDisk = (d: ServerDisk): UiDisk => ({
  id: d.path, path: d.path, model: d.model || "Disk", sizeGB: Math.round(d.size / 1e8) / 10, parts: d.parts,
  bus: d.removable ? "USB" : d.path.startsWith("/dev/nvme") ? "NVMe" : d.rotational ? "HDD" : "SSD",
});

const post = (path: string, body?: unknown) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

async function run(disk: UiDisk, plan: Plan, report: (phase: number, percent: number) => void, latest: boolean): Promise<string | void> {
  const r = await post("/install", { disk: disk.path, swapGB: plan.swapGB, latest });
  if (!r.ok) return ((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `The installer refused (${r.status}).`;
  for (;;) {
    await new Promise((ok) => setTimeout(ok, 1000));
    const s = (await (await fetch("/status", { cache: "no-store" })).json()) as Status;
    report(s.phase, s.percent);
    if (s.state === "done") return;
    if (s.state === "failed") return `The install failed. ${s.log.trim().split("\n").slice(-3).join(" ")}`;
  }
}

function App() {
  const [disks, setDisks] = useState<UiDisk[] | null>(null);
  const [problem, setProblem] = useState("");
  const [latest, setLatest] = useState<boolean | null>(null); // null: the network screen has not been answered yet
  useEffect(() => {
    fetch("/disks", { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 501) return setProblem("This system has no installer. Boot the BrasOS install image to install it on a computer.");
        if (!r.ok) return setProblem(`The installer could not list the drives: ${(await r.json().catch(() => ({}))).error ?? r.status}.`);
        setDisks(((await r.json()) as { disks: ServerDisk[] }).disks.map(toUiDisk));
      })
      .catch(() => setProblem("The installer could not be reached."));
  }, []);
  if (problem) return <div className="setup"><div className="setup-card os-install" style={{ minHeight: 0, display: "block", padding: 32 }}><h1>Install BrasOS</h1><p className="lead">{problem}</p></div></div>;
  if (!disks) return null;
  if (latest === null) return <Network onDone={setLatest} />; // first: the internet, and whether to install the newest build
  if (!disks.length) return <div className="setup"><div className="setup-card os-install" style={{ minHeight: 0, display: "block", padding: 32 }}><h1>No drive to install on</h1><p className="lead">No drive was found that is not in use. The drive BrasOS booted from is never offered.</p></div></div>;
  // the prebuilt system on the image is ext4 only; swap becomes a partition the installed system uses if it is there
  return <OsInstall disks={disks} run={(d, p, r) => run(d, p, r, latest)}filesystems={["ext4"]} onRestart={() => void post("/reboot")} />;
}

void os; // importing the SDK makes the window answer the shell's "is it responding" check
const mount = document.getElementById("root");
if (mount) createRoot(mount).render(<App />);
export { App };
