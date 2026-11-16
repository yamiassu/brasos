// Where the Task Manager's numbers come from. Today: SAMPLE data that drifts a little each second, so the interface can be
// built and judged. A host slice (processes, CPU, memory, per-window end task, gated by its own capability) replaces
// `useSnapshot` later; the interface only depends on the `Snapshot` shape below.
import { useEffect, useRef, useState } from "react";

export type Proc = { id: string; name: string; icon: string; kind: "app" | "system"; state: "running" | "not-responding"; cpu: number; mem: number };
export type StartupItem = { id: string; name: string; icon: string; detail: string; impact: "low" | "medium" | "high"; enabled: boolean };
export type Snapshot = {
  procs: Proc[]; cpu: number[]; mem: number[]; memTotal: number; sample: boolean; endTask(id: string): void;
  startup: StartupItem[]; setStartupEnabled(id: string, enabled: boolean): void; removeStartup(id: string): void;
};

const SEED: Proc[] = [
  { id: "shell", name: "Shell", icon: "start", kind: "system", state: "running", cpu: 3, mem: 214 },
  { id: "host", name: "BrasOS host", icon: "dev", kind: "system", state: "running", cpu: 1.5, mem: 96 },
  { id: "files", name: "Files", icon: "files", kind: "app", state: "running", cpu: 0.6, mem: 88 },
  { id: "religare", name: "Religare", icon: "religare", kind: "app", state: "running", cpu: 5.2, mem: 342 },
  { id: "docs", name: "Docs", icon: "docs", kind: "app", state: "running", cpu: 0.2, mem: 64 },
  { id: "terminal", name: "Terminal", icon: "terminal", kind: "app", state: "running", cpu: 0.4, mem: 71 },
  { id: "crash-test", name: "Crash Test", icon: "crash", kind: "app", state: "not-responding", cpu: 0, mem: 40 },
];

const STARTUP: StartupItem[] = [
  { id: "shell", name: "Shell", icon: "start", detail: "Desktop, taskbar and windows", impact: "high", enabled: true },
  { id: "files-index", name: "Files indexer", icon: "files", detail: "Keeps search results fresh", impact: "medium", enabled: true },
  { id: "sync", name: "Cloud sync", icon: "network", detail: "Syncs Documents when online", impact: "medium", enabled: true },
  { id: "religare-prefetch", name: "Religare preload", icon: "religare", detail: "Warms up the first page", impact: "low", enabled: false },
  { id: "agent", name: "Agent interface", icon: "dev", detail: "Lets an AI agent use the system", impact: "low", enabled: true },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const HISTORY = 60;

export function useSnapshot(): Snapshot {
  const [procs, setProcs] = useState(SEED);
  const [cpu, setCpu] = useState<number[]>(() => Array(HISTORY).fill(8));
  const [mem, setMem] = useState<number[]>(() => Array(HISTORY).fill(30));
  const [startup, setStartup] = useState(STARTUP);
  const memTotal = 4096;
  const used = useRef(0);

  useEffect(() => {
    const t = setInterval(() => {
      setProcs((ps) => {
        const next = ps.map((p) => (p.state === "not-responding" ? p : { ...p, cpu: clamp(p.cpu + (Math.random() - 0.5) * 1.2, 0, 40), mem: clamp(p.mem + (Math.random() - 0.5) * 4, 20, 900) }));
        used.current = next.reduce((a, p) => a + p.mem, 0);
        setCpu((h) => [...h.slice(1), clamp(next.reduce((a, p) => a + p.cpu, 0), 0, 100)]);
        setMem((h) => [...h.slice(1), (used.current / memTotal) * 100]);
        return next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  return { procs, cpu, mem, memTotal, sample: true, endTask: (id) => setProcs((ps) => ps.filter((p) => p.id !== id)),
    startup,
    setStartupEnabled: (id, enabled) => setStartup((l) => l.map((i) => (i.id === id ? { ...i, enabled } : i))),
    removeStartup: (id) => setStartup((l) => l.filter((i) => i.id !== id)),
  };
}
