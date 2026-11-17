import { useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { os } from "@brasos/sdk";
import { Button, Icon, SelectField } from "@brasos/ui";
import "@brasos/ui/ui.css";
import "./settings.css";
import { useSystem } from "./data";

const PAGES = [
  { id: "system", name: "System", icon: "chip" },
  { id: "display", name: "Display", icon: "display" },
  { id: "sound", name: "Sound", icon: "sound" },
  { id: "network", name: "Network", icon: "network" },
  { id: "devices", name: "Devices", icon: "plug" },
  { id: "drivers", name: "Drivers", icon: "dev" },
  { id: "updates", name: "Updates", icon: "reload" },
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

type UpdateState = { enabled: boolean; current: string; url: string; latest: { version: string; notes: string } | null; available: boolean; error: string; job: { state: "idle" | "running" | "done" | "failed"; action: string; log: string } };

/** the Updates page: what this system is, what the update server offers, and the three things that change it (all through `system.update`) */
function UpdatesPage() {
  const [u, setU] = useState<UpdateState | null | "none">(null);
  const [asked, setAsked] = useState("");
  const load = () => fetch("/updates", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then(setU).catch(() => setU((x) => x ?? "none"));
  useEffect(() => {
    void load();
    const t = setInterval(load, 4000); // also follows a running job
    return () => clearInterval(t);
  }, []);
  const run = async (action: string) => {
    setAsked(action);
    const r = await fetch("/updates/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    if (!r.ok) setAsked(`failed: ${(await r.json().catch(() => ({}))).error ?? r.status}`);
    void load();
  };
  if (u === null) return <Card><p className="note">Checking…</p></Card>;
  if (u === "none") return <Card><p className="note">Updates are not available here: this is the sample view (Storybook or a plain browser), or the system has no update support.</p></Card>;
  const busy = u.job.state === "running";
  return (
    <>
      <Card title="This system">
        <Row label="Version"><span className="value mono">{u.current || "unknown"}</span></Row>
        <Row label="Update server"><span className="value">{u.url || "none configured"}</span></Row>
        <Row label="Latest" hint={u.latest?.notes}><span className="value mono">{u.latest ? u.latest.version : "unknown"}</span></Row>
        {u.error && <p className="note">{u.error}</p>}
        {u.latest && !u.error && <p className="note">{u.available ? "A different build is available." : "You are up to date."}</p>}
      </Card>
      <Card title="Change the system">
        {!u.enabled && <p className="note">This system cannot update itself: it is a live image, or the image has no updater.</p>}
        <Row label="Update" hint="Download and switch to the build the server offers. Needs a network.">
          <Button variant="primary" disabled={!u.enabled || busy || !u.available} onClick={() => run("apply")}>Update now</Button>
        </Row>
        <Row label="Rebuild from this device" hint="Build the editable copy of BrasOS in /var/lib/brasos/flake, so changes made here take effect.">
          <Button disabled={!u.enabled || busy} onClick={() => run("rebuild")}>Rebuild</Button>
        </Row>
        <Row label="Roll back" hint="Return to the previous generation. The boot menu keeps older ones too.">
          <Button variant="danger" disabled={!u.enabled || busy} onClick={() => run("rollback")}>Roll back</Button>
        </Row>
        {busy && <p className="note" role="status">Working: {u.job.action}… the screen may restart when it finishes.</p>}
        {u.job.state === "done" && <p className="note" role="status">Finished. Restart to be sure everything runs the new system.</p>}
        {u.job.state === "failed" && <p className="note" role="alert">It failed. The system was not changed beyond what Nix completed. Last output: <span className="mono">{u.job.log.trim().split(/\r?\n/).slice(-3).join(" · ")}</span></p>}
        {asked.startsWith("failed") && <p className="note" role="alert">{asked}</p>}
      </Card>
    </>
  );
}

function Settings() {
  const sys = useSystem();
  const [page, setPage] = useState<PageId>("system");
  const [q, setQ] = useState("");
  const d = sys.display;
  const pct = sys.storage.total ? Math.round((sys.storage.used / sys.storage.total) * 100) : 0;
  const groups = [...new Set(sys.devices.map((x) => x.group))];
  const drivers = sys.drivers.filter((x) => `${x.name} ${x.device}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="settings">
      <nav aria-label="Settings">
        <h1>Settings</h1>
        {PAGES.map((p) => (
          <button key={p.id} type="button" aria-current={page === p.id ? "page" : undefined} onClick={() => setPage(p.id)}><Icon name={p.icon} size={18} />{p.name}</button>
        ))}
        {sys.sample && <span className="sample" title="No host to ask here (Storybook or a plain browser): these values are made up, and changes are not applied">Sample data</span>}
      </nav>

      <main>
        <h2>{PAGES.find((p) => p.id === page)!.name}</h2>

        {page === "system" && (
          <>
            <Card title="About this device">
              {sys.info.map(([k, v]) => <Row key={k} label={k}><span className="value">{v}</span></Row>)}
            </Card>
            <Card title="Storage">
              <div className="bar" role="img" aria-label={`${pct}% of storage used`}><i style={{ width: `${pct}%` }} /></div>
              <p className="note">{sys.storage.used} GB used of {sys.storage.total} GB</p>
            </Card>
          </>
        )}

        {page === "display" && (
          <Card title={d.name}>
            {!sys.displayApplied && !sys.sample && <p className="note">Display changes are not applied yet: BrasOS cannot change the screen's mode from here.</p>}
            <Row label="Resolution"><SelectField label="Resolution" value={d.resolution} onChange={(e) => sys.setDisplay({ resolution: e.target.value })}>{d.resolutions.map((r) => <option key={r}>{r}</option>)}</SelectField></Row>
            <Row label="Refresh rate"><SelectField label="Refresh rate" value={d.refresh} onChange={(e) => sys.setDisplay({ refresh: +e.target.value })}>{[30, 60, 75, 120].map((r) => <option key={r} value={r}>{r} Hz</option>)}</SelectField></Row>
            <Row label="Scale" hint="Make everything larger or smaller"><SelectField label="Scale" value={d.scale} onChange={(e) => sys.setDisplay({ scale: +e.target.value })}>{[100, 125, 150, 200].map((r) => <option key={r} value={r}>{r}%</option>)}</SelectField></Row>
            <Row label="Brightness"><Slider label="Brightness" value={d.brightness} onChange={(v) => sys.setDisplay({ brightness: v })} /></Row>
            <Row label="Night light" hint="Warmer colors in the evening"><Switch label="Night light" on={d.nightLight} onChange={(v) => sys.setDisplay({ nightLight: v })} /></Row>
          </Card>
        )}

        {page === "sound" && (
          <Card title="Output">
            {!sys.soundAvailable && <p className="note">This system has no sound server running, so there is nothing to control.</p>}
            <Row label="Output device"><SelectField label="Output device" value={sys.sound.output} onChange={(e) => sys.setSound({ output: e.target.value })}><option>Speakers</option><option>Headphones</option><option>HDMI</option></SelectField></Row>
            <Row label="Volume"><Slider label="Volume" value={sys.sound.muted ? 0 : sys.sound.volume} onChange={(v) => sys.setSound({ volume: v, muted: false })} /></Row>
            <Row label="Mute"><Switch label="Mute" on={sys.sound.muted} onChange={(v) => sys.setSound({ muted: v })} /></Row>
          </Card>
        )}

        {page === "network" && (
          <>
            <Card title="Connection">
              <Row label="Airplane mode" hint={sys.airplaneAvailable ? "Turns off every radio" : "This system cannot switch radios"}><Switch label="Airplane mode" on={sys.network.airplane} onChange={(v) => sys.setNetwork({ airplane: v })} /></Row>
              <Row label="Status"><span className={`value ${sys.network.airplane ? "bad" : "ok"}`}>{sys.network.airplane ? "Off" : "Connected"}</span></Row>
              <Row label="Adapter"><span className="value">{sys.adapter.name}</span></Row>
              <Row label="IP address"><span className="value mono">{sys.network.airplane ? "none" : sys.adapter.ip}</span></Row>
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

        {page === "updates" && <UpdatesPage />}

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
