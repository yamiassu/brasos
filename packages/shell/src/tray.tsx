// The right side of the taskbar: the security mode, network, battery (only where there is one) and the clock. The clock opens a
// calendar with the time zone, the network opens the connection's details and the Wi-Fi networks in range (and joins one).
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Icon, TrayItem } from "@brasos/ui";
import { dayOfYear, firstWeekday, isoWeek, monthGrid, sameDay, todayIn, zoneInfo } from "./calendar";

/** a panel above the taskbar's right end: closes on Escape, on a press outside it, or when the page loses focus (a click into a window) */
function Popover({ label, onClose, children }: { label: string; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // the tray button that opened it is wrapped in [data-tray-toggle]: its own click closes the panel, so a press on it is not "outside"
    const down = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!ref.current?.contains(t as Node) && !t?.closest?.("[data-tray-toggle]")) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("pointerdown", down, true);
    addEventListener("keydown", key);
    addEventListener("blur", onClose);
    return () => (removeEventListener("pointerdown", down, true), removeEventListener("keydown", key), removeEventListener("blur", onClose));
  }, [onClose]);
  return <div ref={ref} className="tray-pop" role="dialog" aria-label={label}>{children}</div>;
}

export function Clock({ timezone, clock24 }: { timezone?: string; clock24?: boolean }) {
  const [now, setNow] = useState(() => new Date());
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), open ? 1000 : 15_000); // seconds tick only while the panel shows them
    return () => clearInterval(t);
  }, [open]);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <span data-tray-toggle>
        <TrayItem label={`${now.toLocaleString([], { timeZone: timezone })} (open the calendar)`} onClick={() => setOpen((o) => !o)}>
          <span className="stack">
            <span>{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: clock24 === undefined ? undefined : !clock24, timeZone: timezone })}</span>
            <span>{now.toLocaleDateString([], { day: "2-digit", month: "2-digit", timeZone: timezone })}</span>
          </span>
        </TrayItem>
      </span>
      {open && <Popover label="Calendar and time" onClose={close}><CalendarPanel now={now} timezone={timezone} clock24={clock24} /></Popover>}
    </>
  );
}

function CalendarPanel({ now, timezone, clock24 }: { now: Date; timezone?: string; clock24?: boolean }) {
  const today = todayIn(now, timezone);
  const [view, setView] = useState({ y: today.y, m: today.m });
  const first = firstWeekday();
  const grid = monthGrid(view.y, view.m, first);
  const zone = zoneInfo(now, timezone);
  const hour12 = clock24 === undefined ? undefined : !clock24;
  const step = (n: number) => setView((v) => { const t = new Date(Date.UTC(v.y, v.m + n, 1)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() }; });
  // weekday headings from a known Monday (2024-01-01), in the order the week starts
  const heads = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2024, 0, ((first - 1 + i) % 7) + 1)).toLocaleDateString([], { weekday: "narrow", timeZone: "UTC" }));
  const monthName = new Date(Date.UTC(view.y, view.m, 1)).toLocaleDateString([], { month: "long", year: "numeric", timeZone: "UTC" });
  const away = view.y !== today.y || view.m !== today.m;
  return (
    <>
      <div className="cal-time">
        <b>{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12, timeZone: timezone })}</b>
        <span>{now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: timezone })}</span>
      </div>
      <div className="cal-head">
        <button type="button" className="cal-nav" aria-label="Previous month" onClick={() => step(-1)}>‹</button>
        <b>{monthName}</b>
        {away && <button type="button" className="cal-today" onClick={() => setView({ y: today.y, m: today.m })}>Today</button>}
        <button type="button" className="cal-nav" aria-label="Next month" onClick={() => step(1)}>›</button>
      </div>
      <table className="cal-grid" aria-label={monthName}>
        <thead><tr><th scope="col" aria-label="Week">#</th>{heads.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr></thead>
        <tbody>
          {grid.map((row, r) => (
            <tr key={r}>
              <th scope="row" className="wk">{isoWeek(row[3])}</th>
              {row.map((c) => (
                <td key={`${c.m}-${c.d}`} className={`${c.inMonth ? "" : "out "}${sameDay(c, today) ? "today" : ""}`} aria-current={sameDay(c, today) ? "date" : undefined}>{c.d}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="cal-info">
        <dt>Time zone</dt><dd>{zone.name} ({zone.offset}{zone.short && zone.short !== zone.offset ? `, ${zone.short}` : ""})</dd>
        <dt>UTC</dt><dd>{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12, timeZone: "UTC" })}</dd>
        <dt>This day</dt><dd>Week {isoWeek(today)}, day {dayOfYear(today)} of the year</dd>
      </dl>
    </>
  );
}

type Wifi = { ssid: string; signal: number; secure: boolean; active: boolean };
type Net = {
  available: boolean; connected?: boolean; hasWifi?: boolean; wifiEnabled?: boolean; wifi?: Wifi[];
  active?: { device: string; type: string; connection: string; ip: string; gateway: string; dns: string[]; ssid?: string; signal?: number } | null;
};
const post = (path: string, body?: unknown) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

export function Network({ onSettings }: { onSettings?: () => void }) {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    addEventListener("online", on);
    addEventListener("offline", off);
    return () => (removeEventListener("online", on), removeEventListener("offline", off));
  }, []);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <span data-tray-toggle>
        <TrayItem icon={online ? "network" : "offline"} label={online ? "Network: connected (open the network panel)" : "Network: offline (open the network panel)"} onClick={() => setOpen((o) => !o)} />
      </span>
      {open && <Popover label="Network" onClose={close}><NetworkPanel online={online} onSettings={onSettings && (() => (close(), onSettings()))} /></Popover>}
    </>
  );
}

function NetworkPanel({ online, onSettings }: { online: boolean; onSettings?: () => void }) {
  const [net, setNet] = useState<Net | null>(null);
  const [picked, setPicked] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async (rescan = false) => {
    try {
      const r = await fetch(`/os/network${rescan ? "?rescan=1" : ""}`, { cache: "no-store" });
      setNet(r.ok ? await r.json() : { available: false });
    } catch {
      setNet({ available: false });
    }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 6000);
    return () => clearInterval(t);
  }, [load]);

  const connect = async (ssid: string, pw: string) => {
    setBusy(ssid);
    setError("");
    const r = await post("/os/network/connect", { ssid, password: pw }).catch(() => null);
    if (r?.ok) (setPicked(""), setPassword(""));
    else setError(((await r?.json().catch(() => null)) as { error?: string } | null)?.error ?? "could not connect");
    setBusy("");
    void load();
  };
  const disconnect = async () => {
    setBusy("-");
    await post("/os/network/disconnect").catch(() => null);
    setBusy("");
    void load();
  };

  if (!net) return <p className="note">Checking…</p>;
  const a = net.active;
  return (
    <>
      <div className="net-head">
        <Icon name={online ? "network" : "offline"} size={20} />
        <div><b>{a ? (a.ssid ?? a.connection ?? "Connected") : online ? "Connected" : "Not connected"}</b><small>{a ? (a.type === "wifi" ? "Wi-Fi" : a.type === "ethernet" ? "Cable" : a.type) : online ? "The browser reports it is online" : "Choose a Wi-Fi network or plug in a cable"}</small></div>
        {a?.type === "wifi" && <Button disabled={!!busy} onClick={() => void disconnect()}>Disconnect</Button>}
      </div>
      {a && (
        <dl className="cal-info">
          <dt>Address</dt><dd>{a.ip || "unknown"}</dd>
          {a.gateway && <><dt>Gateway</dt><dd>{a.gateway}</dd></>}
          {a.dns.length > 0 && <><dt>DNS</dt><dd>{a.dns.join(", ")}</dd></>}
          <dt>Device</dt><dd>{a.device}{a.signal !== undefined ? ` · signal ${a.signal}%` : ""}</dd>
        </dl>
      )}
      {!net.available && <p className="note">Network details are not available here: this system has no network manager (or this is the hardened image). The tray shows only whether the browser is online.</p>}
      {net.available && !net.hasWifi && <p className="note">No Wi-Fi adapter was found. A network cable connects by itself.</p>}
      {net.available && net.hasWifi && (
        <>
          <div className="net-list-head"><b>Wi-Fi networks</b><button type="button" className="cal-today" onClick={() => void load(true)}>Refresh</button></div>
          {net.wifiEnabled === false && <p className="note">Wi-Fi is switched off (airplane mode or a switch on the computer).</p>}
          {net.wifi?.length === 0 && net.wifiEnabled !== false && <p className="note">No networks in range (or still scanning).</p>}
          <ul className="net-list">
            {net.wifi?.map((w) => (
              <li key={w.ssid}>
                <button type="button" className="net-item" disabled={!!busy} onClick={() => (w.active ? undefined : w.secure ? (setPicked(picked === w.ssid ? "" : w.ssid), setPassword(""), setError("")) : void connect(w.ssid, ""))}>
                  <Icon name={w.secure ? "lock" : "network"} size={14} />
                  <span className="grow">{w.ssid}</span>
                  <small>{busy === w.ssid ? "Connecting…" : w.active ? "Connected" : `${w.signal}%`}</small>
                </button>
                {picked === w.ssid && (
                  <form className="net-pw" onSubmit={(e) => (e.preventDefault(), void connect(w.ssid, password))}>
                    <input type="password" autoFocus autoComplete="off" placeholder={`Password for ${w.ssid}`} aria-label={`Password for ${w.ssid}`} value={password} onChange={(e) => setPassword(e.target.value)} />
                    <Button type="submit" variant="primary" disabled={!!busy || password.length < 8}>Connect</Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <p role="alert" className="note net-err">{error}</p>}
      {onSettings && <button type="button" className="cal-today net-more" onClick={onSettings}>Network settings</button>}
    </>
  );
}

/**
 * Only where there is a battery. Chromium answers the Battery API on every machine; a computer without one reports the fixed answer
 * "full, charging, never discharging", so that exact answer means "no battery" (a laptop full on mains shows up once it is unplugged).
 */
export function Battery() {
  const [s, setS] = useState<{ level: number; charging: boolean } | null>(null);
  useEffect(() => {
    let b: any;
    const update = () => setS(b.level === 1 && b.charging && b.chargingTime === 0 && b.dischargingTime === Infinity ? null : { level: Math.round(b.level * 100), charging: b.charging });
    const evs = ["levelchange", "chargingchange"];
    (navigator as any).getBattery?.().then((x: any) => ((b = x), update(), evs.forEach((e) => b.addEventListener(e, update)))).catch(() => {});
    return () => b && evs.forEach((e) => b.removeEventListener(e, update));
  }, []);
  return s === null ? null : <TrayItem icon="battery" label={`Battery ${s.level}%${s.charging ? ", charging" : ""}`}>{s.level}%{s.charging ? " ⚡" : ""}</TrayItem>;
}

/** nobody should mistake a dev image for a hardened one */
export function Mode({ packages }: { packages: string[] | null }) {
  if (!packages) return null;
  return packages.includes("hardened") ? (
    <TrayItem icon="shield" label="Hardened package on (work in progress, not certified)">Hardened</TrayItem>
  ) : (
    <span className="ui-tray-item ui-tray-item--warn" role="status" title="Hardened package off: not secure"><TrayItem icon="dev" label="Development image: hardened package off, not secure">DEV</TrayItem></span>
  );
}
