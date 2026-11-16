import { useState } from "react";
import { createRoot } from "react-dom/client";
import { os } from "@brasos/sdk";
import { Button, Dialog, Icon, Menu, type MenuItem } from "@brasos/ui";
import "@brasos/ui/ui.css";
import "./task-manager.css";
import { useSnapshot, type Proc, type StartupItem } from "./data";

type SortKey = "name" | "cpu" | "mem";
type Tab = "processes" | "performance" | "startup";
const TABS: [Tab, string][] = [["processes", "Processes"], ["performance", "Performance"], ["startup", "Startup"]];

const mb = (v: number) => (v >= 1024 ? `${(v / 1024).toFixed(1)} GB` : `${Math.round(v)} MB`);

/** a small area chart: values are percentages, newest on the right */
function Spark({ values, color, label }: { values: number[]; color: string; label: string }) {
  const w = 240, h = 64;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - (Math.min(100, v) / 100) * (h - 4) - 2] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <path d={`${line}L${w} ${h}L0 ${h}Z`} fill={color} opacity="0.14" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Meter({ value, color }: { value: number; color: string }) {
  return <span className="meter" aria-hidden="true"><i style={{ width: `${Math.min(100, value)}%`, background: color }} /></span>;
}

function TaskManager() {
  const snap = useSnapshot();
  const [tab, setTab] = useState<Tab>("processes");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "cpu", desc: true });
  const [selected, setSelected] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Proc | null>(null);
  const [removing, setRemoving] = useState<StartupItem | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; p: Proc } | null>(null);

  const rows = [...snap.procs].sort((a, b) => (sort.key === "name" ? a.name.localeCompare(b.name) : a[sort.key] - b[sort.key]) * (sort.desc ? -1 : 1));
  const groups = [["Apps", rows.filter((p) => p.kind === "app")], ["System", rows.filter((p) => p.kind === "system")]] as const;
  const sel = snap.procs.find((p) => p.id === selected) ?? null;
  const cpuNow = snap.cpu[snap.cpu.length - 1], memNow = snap.mem[snap.mem.length - 1];
  const sortBy = (key: SortKey) => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "name" }));
  const head = (key: SortKey, label: string) => (
    <th aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button type="button" onClick={() => sortBy(key)}>{label}{sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}</button>
    </th>
  );
  const menuItems = (p: Proc): MenuItem[] => [{ label: "End task", danger: true, onSelect: () => setConfirm(p) }];

  return (
    <div className="tm">
      <header className="tm-bar">
        <div role="tablist" aria-label="View">
          {TABS.map(([t, l]) => <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)}>{l}</button>)}
        </div>
        {snap.sample && <span className="sample" title="No process data from the host yet: these numbers are made up">Sample data</span>}
        <span className="grow" />
        {tab === "processes" && <Button variant="danger" disabled={!sel} onClick={() => sel && setConfirm(sel)}>End task</Button>}
      </header>

      {tab === "processes" ? (
        <div className="tm-table">
          <table>
            <thead><tr>{head("name", "Name")}<th>Status</th>{head("cpu", "CPU")}{head("mem", "Memory")}</tr></thead>
            {groups.map(([title, list]) => list.length > 0 && (
              <tbody key={title}>
                <tr className="group"><th colSpan={4}>{title} <span>{list.length}</span></th></tr>
                {list.map((p) => (
                  <tr key={p.id} aria-selected={selected === p.id} onClick={() => setSelected(p.id)} onContextMenu={(e) => (e.preventDefault(), setSelected(p.id), setMenu({ x: e.clientX, y: e.clientY, p }))}>
                    <td className="name"><Icon name={p.icon} size={18} />{p.name}</td>
                    <td className={p.state === "not-responding" ? "bad" : "muted"}>{p.state === "not-responding" ? "Not responding" : "Running"}</td>
                    <td className="num"><Meter value={p.cpu * 2} color="var(--accent)" />{p.cpu.toFixed(1)}%</td>
                    <td className="num"><Meter value={(p.mem / snap.memTotal) * 400} color="var(--accent-2)" />{mb(p.mem)}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
          {!snap.procs.length && <p className="empty">Nothing is running.</p>}
        </div>
      ) : tab === "startup" ? (
        <div className="tm-table">
          <p className="hint">These start by themselves when BrasOS starts. Turn one off to stop it without losing it, or remove it for good.</p>
          <table className="startup">
            <thead><tr><th>Name</th><th>Impact</th><th>Starts at boot</th><th><span className="sr">Remove</span></th></tr></thead>
            <tbody>
              {snap.startup.map((i) => (
                <tr key={i.id} className={i.enabled ? undefined : "off"}>
                  <td className="name"><Icon name={i.icon} size={18} /><span>{i.name}<small>{i.detail}</small></span></td>
                  <td className={`impact ${i.impact}`}>{i.impact[0].toUpperCase() + i.impact.slice(1)}</td>
                  <td><button type="button" role="switch" className="switch" aria-checked={i.enabled} aria-label={`${i.name} starts at boot`} onClick={() => snap.setStartupEnabled(i.id, !i.enabled)} /></td>
                  <td className="num"><Button variant="danger" onClick={() => setRemoving(i)}>Remove</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!snap.startup.length && <p className="empty">Nothing starts by itself.</p>}
        </div>
      ) : (
        <div className="tm-perf">
          <section aria-label="CPU">
            <h3>CPU <b>{cpuNow.toFixed(0)}%</b></h3>
            <Spark values={snap.cpu} color="var(--accent)" label="CPU use over the last minute" />
            <p>Last 60 seconds · {snap.procs.length} processes</p>
          </section>
          <section aria-label="Memory">
            <h3>Memory <b>{mb((memNow / 100) * snap.memTotal)}</b> <small>of {mb(snap.memTotal)}</small></h3>
            <Spark values={snap.mem} color="var(--accent-2)" label="Memory use over the last minute" />
            <p>{memNow.toFixed(0)}% in use</p>
          </section>
        </div>
      )}

      <footer className="tm-foot" role="status">
        <span>CPU <b>{cpuNow.toFixed(0)}%</b></span>
        <span>Memory <b>{memNow.toFixed(0)}%</b></span>
        <span>{snap.procs.length} processes</span>
      </footer>

      {menu && <Menu items={menuItems(menu.p)} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
      {removing && (
        <Dialog title={`Remove ${removing.name} from startup?`} onClose={() => setRemoving(null)} actions={<><Button onClick={() => setRemoving(null)}>Cancel</Button><Button variant="danger" autoFocus onClick={() => (snap.removeStartup(removing.id), setRemoving(null))}>Remove</Button></>}>
          <p>It will no longer start with BrasOS. This does not uninstall anything.</p>
        </Dialog>
      )}
      {confirm && (
        <Dialog title={`End ${confirm.name}?`} onClose={() => setConfirm(null)} actions={<><Button onClick={() => setConfirm(null)}>Cancel</Button><Button variant="danger" autoFocus onClick={() => (snap.endTask(confirm.id), setConfirm(null), setSelected(null))}>End task</Button></>}>
          <p>Unsaved work in {confirm.name} will be lost.</p>
        </Dialog>
      )}
    </div>
  );
}

void os; // importing the SDK makes the window answer the shell's "is it responding" check

// the page mounts when there is a #root; Storybook imports the component instead
const mount = document.getElementById("root");
if (mount) createRoot(mount).render(<TaskManager />);

export { TaskManager };
