import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { os } from "@brasos/sdk";
import { Button, Icon, SelectField, defaultTheme, themePresets, themeVars, validateTheme, type Theme } from "@brasos/ui";
import "@brasos/ui/ui.css";
import "./settings.css";
import { useSystem } from "./data";

const PAGES = [
  { id: "system", name: "System", icon: "chip" },
  { id: "display", name: "Display", icon: "display" },
  { id: "theme", name: "Theme", icon: "theme" },
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

type UpdateState = { enabled: boolean; current: string; interface: { system: string; from: string; state: "current" | "older" | "unstamped" } | null; url: string; latest: { version: string; notes: string } | null; available: boolean; error: string; job: { state: "idle" | "running" | "done" | "failed"; action: string; log: string; progress?: { step: string; detail: string; fetched: number; fetchTotal: number; built: number; buildTotal: number; started: number; last: number } } };

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
        {u.interface && (
          <Row
            label="Interface"
            hint={u.interface.state === "older" ? "The apps on screen come from an older build (they were edited, or the interface hasn't restarted since the update). Start → Restart the interface, or run brasos-reset-shell in the Terminal to start from this build (that drops your edits)." : u.interface.state === "unstamped" ? "This copy of the interface has no build record; an update will back it up and replace it." : "The apps on screen are from the running system's build."}
          >
            <span className={`value mono ${u.interface.state === "older" ? "bad" : "ok"}`}>
              {u.interface.state === "older" ? `build ${u.interface.from || "unknown"} · system ${u.interface.system}` : `build ${u.interface.system}${u.interface.state === "current" ? " · current" : ""}`}
            </span>
          </Row>
        )}
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
        {busy && <UpdateProgress job={u.job} />}
        {u.job.state === "done" && (
          <Row label="Update finished" hint="Restart the computer to apply every change (the screen, boot and system parts only change after a restart).">
            <Button variant="primary" onClick={() => os.requestRestart()}>Restart the computer</Button>
          </Row>
        )}        {u.job.state === "failed" && <p className="note" role="alert">It failed. The system was not changed beyond what Nix completed. Last output: <span className="mono">{u.job.log.trim().split(/\r?\n/).slice(-3).join(" · ")}</span></p>}
        {asked.startsWith("failed") && <p className="note" role="alert">{asked}</p>}
      </Card>
    </>
  );
}

const COLORS: { key: keyof Theme["custom"]; label: string; hint: string; css: string; fallback: string }[] = [
  { key: "accent", label: "Accent", hint: "Buttons, focus and highlights", css: "--accent", fallback: "#5fd39a" },
  { key: "accent2", label: "Second accent", hint: "The partner color in gradients", css: "--accent-2", fallback: "#9b87f5" },
  { key: "bg", label: "Background", hint: "Behind every window", css: "--bg", fallback: "#0c0c0d" },
  { key: "panel", label: "Panels", hint: "Cards, menus and window bodies", css: "--panel", fallback: "#131314" },
  { key: "text", label: "Text", hint: "Main text color", css: "--text", fallback: "#ececee" },
];

/** the Theme page: presets, colors, wallpaper and corner shape. Saved in the shared database; the shell applies it live to itself and every window */
function ThemePage() {
  const col = useMemo(() => os.db.collection("theme", { space: "shared" }), []);
  const [t, setT] = useState<Theme>(defaultTheme);
  const [err, setErr] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    col.get("current").then((r) => setT(validateTheme(r.doc))).catch(() => {});
    return col.watch((e) => e.id === "current" && setT(e.op === "put" ? validateTheme(e.doc) : defaultTheme()));
  }, [col]);
  // the controls update at once; the save is debounced so dragging a color picker is one write, not hundreds
  const save = (n: Theme) => {
    setT(n);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => col.put(n, "current").then(() => setErr(""), (e) => setErr(`Could not save the theme: ${e?.message ?? e}`)), 150);
  };
  const eff = themeVars(t).vars;
  const w = t.wallpaper;
  return (
    <>
      <Card title="Theme">
        <div className="presets" role="radiogroup" aria-label="Theme">
          {Object.entries(themePresets).map(([id, p]) => (
            <button key={id} type="button" role="radio" aria-checked={t.preset === id} className="preset" onClick={() => save({ ...t, preset: id, custom: {} })}>
              <span className="chips">{p.swatch.map((c) => <i key={c} style={{ background: c }} />)}</span>
              {p.label}
            </button>
          ))}
        </div>
        <p className="note">Pick a look, then change any color below. Choosing a theme again clears your custom colors.</p>
      </Card>
      <Card title="Colors">
        {COLORS.map((c) => (
          <Row key={c.key} label={c.label} hint={c.hint}>
            <input type="color" aria-label={c.label} value={eff[c.css]?.slice(0, 7) ?? c.fallback} onChange={(e) => save({ ...t, custom: { ...t.custom, [c.key]: e.target.value } })} />
          </Row>
        ))}
      </Card>
      <Card title="Wallpaper">
        <Row label="Style">
          <SelectField label="Wallpaper style" value={w.kind} onChange={(e) => save({ ...t, wallpaper: { ...w, kind: e.target.value as Theme["wallpaper"]["kind"] } })}>
            <option value="default">Theme default</option><option value="solid">Solid color</option><option value="gradient">Gradient</option>
          </SelectField>
        </Row>
        {w.kind !== "default" && <Row label={w.kind === "gradient" ? "From" : "Color"}><input type="color" aria-label="Wallpaper color" value={w.a ?? "#0c0c0d"} onChange={(e) => save({ ...t, wallpaper: { ...w, a: e.target.value } })} /></Row>}
        {w.kind === "gradient" && (
          <>
            <Row label="To"><input type="color" aria-label="Wallpaper second color" value={w.b ?? "#1a1a2e"} onChange={(e) => save({ ...t, wallpaper: { ...w, b: e.target.value } })} /></Row>
            <Row label="Angle"><span className="slider"><input type="range" min={0} max={360} aria-label="Gradient angle" value={w.angle ?? 135} onChange={(e) => save({ ...t, wallpaper: { ...w, angle: +e.target.value } })} /><output>{w.angle ?? 135}°</output></span></Row>
          </>
        )}
      </Card>
      <Card title="Shape">
        <Row label="Corner roundness" hint="Windows, cards and buttons">
          <span className="slider"><input type="range" min={0} max={20} aria-label="Corner roundness" value={t.radius ?? 10} onChange={(e) => save({ ...t, radius: +e.target.value })} /><output>{t.radius ?? 10}px</output></span>
        </Row>
      </Card>
      <Card>
        <Row label="Reset" hint="Back to the default Night theme"><Button onClick={() => save(defaultTheme())}>Reset theme</Button></Row>
        {err && <p className="note" role="alert">{err}</p>}
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

        {page === "theme" && <ThemePage />}

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

/** What the update is doing now, how long it has been going and when it last printed anything, so a quiet stretch can be told from a stuck one */
function UpdateProgress({ job }: { job: UpdateState["job"] }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const p = job.progress;
  const mins = (ms: number) => (ms < 60_000 ? `${Math.max(0, Math.round(ms / 1000))} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);
  const frac = p && p.step === "Downloading" && p.fetchTotal ? Math.min(1, p.fetched / p.fetchTotal) : undefined;
  return (
    <div className="progress" role="status">
      <p className="note"><strong>{p?.step || `Working: ${job.action}`}</strong>{p?.detail ? ` · ${p.detail}` : ""}</p>
      <progress max={frac === undefined ? undefined : 1} value={frac} aria-label="Update progress" />
      <p className="note">
        {p?.fetchTotal ? `${p.fetched} of ${p.fetchTotal} downloads` : ""}{p?.fetchTotal && p.built ? " · " : ""}{p?.built ? `${p.built}${p.buildTotal ? ` of ${p.buildTotal}` : ""} built` : ""}
        {p?.fetchTotal || p?.built ? " · " : ""}running for {mins(now - (p?.started ?? now))}{p ? ` · last activity ${mins(now - p.last)} ago` : ""}
      </p>
      <p className="note">The screen may restart when it finishes.</p>
    </div>
  );
}
