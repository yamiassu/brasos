// The right side of the taskbar: the security mode, network, battery (only where there is one) and the clock.
import { useEffect, useState } from "react";
import { TrayItem } from "@brasos/ui";

export function Clock({ timezone, clock24 }: { timezone?: string; clock24?: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return (
    <TrayItem label={now.toLocaleString([], { timeZone: timezone })}>
      <span className="stack">
        <span>{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: clock24 === undefined ? undefined : !clock24, timeZone: timezone })}</span>
        <span>{now.toLocaleDateString([], { day: "2-digit", month: "2-digit", timeZone: timezone })}</span>
      </span>
    </TrayItem>
  );
}

export function Network() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    addEventListener("online", on);
    addEventListener("offline", off);
    return () => (removeEventListener("online", on), removeEventListener("offline", off));
  }, []);
  return <TrayItem icon={online ? "network" : "offline"} label={online ? "Network: connected" : "Network: offline"} />;
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
