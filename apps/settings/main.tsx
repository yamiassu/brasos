import { useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { os } from "@brasos/sdk";
import { Icon, SelectField } from "@brasos/ui";
import "@brasos/ui/ui.css";
import "./settings.css";
import { INFO, STORAGE, useSystem } from "./data";

const PAGES = [
  { id: "system", name: "System", icon: "chip" },
  { id: "display", name: "Display", icon: "display" },
  { id: "sound", name: "Sound", icon: "sound" },
  { id: "network", name: "Network", icon: "network" },
  { id: "devices", name: "Devices", icon: "plug" },
  { id: "drivers", name: "Drivers", icon: "dev" },
] as const;
type PageId = (typeof PAGES)[number]["id"];

const Card = ({ title, children }: { title?: string; children: ReactNode }) => (
  <section className="card">{title && <h3>{title}</h3>}{children}</section>
);
const Row = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <div className="row"><div><div className="label">{label}</div>{hint && <small>{hint}</small>}</div><div className="control">{children}</div></div>
);
const Switch = ({ on, label, onChange }: { on: boolean; label: string; onChange(v: boolean): void }) => (
  <button type="button" role="switch" className="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />
);
const Slider = ({ value, label, onChange }: { value: number; label: string; onChange(v: number): void }) => (
  <span className="slider"><input type="range" min={0} max={100} value={value} aria-label={label} onChange={(e) => onChange(+e.target.value)} /><output>{value}%</output></span>
);

function Settings() {
  const sys = useSystem();
  const [page, setPage] = useState<PageId>("system");
  const [q, setQ] = useState("");
  const d = sys.display;
  const pct = Math.round((STORAGE.used / STORAGE.total) * 100);
  const groups = [...new Set(sys.devices.map((x) => x.group))];
  const drivers = sys.drivers.filter((x) => `${x.name} ${x.device}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="settings">
      <nav aria-label="Settings">
        <h1>Settings</h1>
        {PAGES.map((p) => (
          <button key={p.id} type="button" aria-current={page === p.id ? "page" : undefined} onClick={() => setPage(p.id)}><Icon name={p.icon} size={18} />{p.name}</button>
        ))}
        {sys.sample && <span className="sample" title="No system data from the host yet: these values are made up, and changes are not applied">Sample data</span>}
      </nav>

      <main>
        <h2>{PAGES.find((p) => p.id === page)!.name}</h2>

        {page === "system" && (
          <>
            <Card title="About this device">
              {INFO.map(([k, v]) => <Row key={k} label={k}><span className="value">{v}</span></Row>)}
            </Card>
            <Card title="Storage">
              <div className="bar" role="img" aria-label={`${pct}% of storage used`}><i style={{ width: `${pct}%` }} /></div>
              <p className="note">{STORAGE.used} GB used of {STORAGE.total} GB</p>
            </Card>
          </>
        )}

        {page === "display" && (
          <Card title={d.name}>
            <Row label="Resolution"><SelectField label="Resolution" value={d.resolution} onChange={(e) => sys.setDisplay({ resolution: e.target.value })}>{d.resolutions.map((r) => <option key={r}>{r}</option>)}</SelectField></Row>
            <Row label="Refresh rate"><SelectField label="Refresh rate" value={d.refresh} onChange={(e) => sys.setDisplay({ refresh: +e.target.value })}>{[30, 60, 75, 120].map((r) => <option key={r} value={r}>{r} Hz</option>)}</SelectField></Row>
            <Row label="Scale" hint="Make everything larger or smaller"><SelectField label="Scale" value={d.scale} onChange={(e) => sys.setDisplay({ scale: +e.target.value })}>{[100, 125, 150, 200].map((r) => <option key={r} value={r}>{r}%</option>)}</SelectField></Row>
            <Row label="Brightness"><Slider label="Brightness" value={d.brightness} onChange={(v) => sys.setDisplay({ brightness: v })} /></Row>
            <Row label="Night light" hint="Warmer colors in the evening"><Switch label="Night light" on={d.nightLight} onChange={(v) => sys.setDisplay({ nightLight: v })} /></Row>
          </Card>
        )}

        {page === "sound" && (
          <Card title="Output">
            <Row label="Output device"><SelectField label="Output device" value={sys.sound.output} onChange={(e) => sys.setSound({ output: e.target.value })}><option>Speakers</option><option>Headphones</option><option>HDMI</option></SelectField></Row>
            <Row label="Volume"><Slider label="Volume" value={sys.sound.muted ? 0 : sys.sound.volume} onChange={(v) => sys.setSound({ volume: v, muted: false })} /></Row>
            <Row label="Mute"><Switch label="Mute" on={sys.sound.muted} onChange={(v) => sys.setSound({ muted: v })} /></Row>
          </Card>
        )}

        {page === "network" && (
          <>
            <Card title="Connection">
              <Row label="Airplane mode" hint="Turns off every network"><Switch label="Airplane mode" on={sys.network.airplane} onChange={(v) => sys.setNetwork({ airplane: v })} /></Row>
              <Row label="Status"><span className={`value ${sys.network.airplane ? "bad" : "ok"}`}>{sys.network.airplane ? "Off" : "Connected"}</span></Row>
              <Row label="Adapter"><span className="value">virtio-net (Ethernet)</span></Row>
              <Row label="IP address"><span className="value mono">{sys.network.airplane ? "none" : "10.0.2.15"}</span></Row>
            </Card>
          </>
        )}

        {page === "devices" && groups.map((g) => (
          <Card key={g} title={g}>
            {sys.devices.filter((x) => x.group === g).map((x) => (
              <Row key={x.id} label={x.name} hint={x.detail}><span className={`pill ${x.connected ? "ok" : "off"}`}>{x.connected ? "Connected" : "Not connected"}</span></Row>
            ))}
          </Card>
        ))}

        {page === "drivers" && (
          <>
            <label className="find"><Icon name="search" size={16} /><input type="search" placeholder="Filter drivers" aria-label="Filter drivers" value={q} onChange={(e) => setQ(e.target.value)} /></label>
            <Card>
              <table>
                <thead><tr><th>Driver</th><th>Device</th><th>Type</th><th>Version</th><th>Status</th></tr></thead>
                <tbody>
                  {drivers.map((x) => (
                    <tr key={x.id}><td className="mono">{x.name}</td><td>{x.device}</td><td>{x.kind}</td><td className="mono">{x.version}</td><td><span className={`pill ${x.loaded ? "ok" : "off"}`}>{x.loaded ? "Loaded" : "Not loaded"}</span></td></tr>
                  ))}
                </tbody>
              </table>
              {!drivers.length && <p className="note">No driver matches.</p>}
            </Card>
          </>
        )}
      </main>
    </div>
  );
}

void os; // importing the SDK makes the window answer the shell's "is it responding" check

// the page mounts when there is a #root; Storybook imports the component instead
const mount = document.getElementById("root");
if (mount) createRoot(mount).render(<Settings />);

export { Settings };
