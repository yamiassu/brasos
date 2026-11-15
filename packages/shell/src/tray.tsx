// The right side of the taskbar: the security mode, network, battery and the clock.
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
        <span>{now.toLocaleDateString([], { day: "2-digit", month: "2-digit", year: "numeric", timeZone: timezone })}</span>
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

/** only where the browser has the Battery API (laptops; not in a VM, not in every browser) */
export function Battery() {
  const [level, setLevel] = useState<number | null>(null);
  useEffect(() => {
    let b: any;
    const update = () => setLevel(Math.round(b.level * 100));
    (navigator as any).getBattery?.().then((x: any) => ((b = x), update(), b.addEventListener("levelchange", update))).catch(() => {});
    return () => b?.removeEventListener("levelchange", update);
  }, []);
  return level === null ? null : <TrayItem icon="battery" label={`Battery ${level}%`}>{level}%</TrayItem>;
}

/** nobody should mistake a dev image for a hardened one */
export function Mode({ packages }: { packages: string[] | null }) {
  if (!packages) return null;
  return packages.includes("hardened") ? (
    <TrayItem icon="shield" label="Hardened package on (work in progress, not certified)">Hardened</TrayItem>
  ) : (
    <span className="ui-tray-item ui-tray-item--warn" role="status" title="Hardened package off: not secure"><TrayItem icon="dev" label="Development image: hardened package off, not secure">DEV · not secure</TrayItem></span>
  );
}
