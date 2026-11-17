// The Drives category: every disk in this computer with its volumes and how full they are (apps/files/server.ts reads them).
// Where there is no host (Storybook, a plain browser) it shows SAMPLE drives and says so; where the host cannot list drives it says that.
import { useEffect, useState } from "react";
import { Icon } from "@brasos/ui";
import type { Drive } from "./drives";
import { formatSize } from "./paths";

export const SAMPLE: Drive[] = [
  { path: "/dev/nvme0n1", model: "Samsung SSD 980 1TB", size: 1000204886016, removable: false, rotational: false, volumes: [
    { name: "nvme0n1p1", label: "EFI", fs: "vfat", size: 536870912, used: 62914560, mount: "/boot" },
    { name: "nvme0n1p2", label: "BrasOS", fs: "ext4", size: 999000000000, used: 412000000000, mount: "/" },
  ] },
  { path: "/dev/sda", model: "WDC WD20EZRZ", size: 2000398934016, removable: false, rotational: true, volumes: [
    { name: "sda1", label: "Archive", fs: "ntfs", size: 2000397852160, used: 1620000000000, mount: "/run/media/archive" },
  ] },
  { path: "/dev/sdb", model: "SanDisk Ultra", size: 31914983424, removable: true, rotational: false, volumes: [
    { name: "sdb1", label: "", fs: "exfat", size: 31913934848, used: null, mount: null },
  ] },
];

type State = { drives: Drive[]; sample: boolean } | { error: string } | null;

/** asks the host; a missing host (404, no JSON) falls back to the samples, a refusal or an unsupported system does not */
export function useDrives(on: boolean): State {
  const [s, setS] = useState<State>(null);
  const load = async () => {
    try {
      const r = await fetch("/drives", { cache: "no-store" });
      if (r.status === 501) return setS({ error: ((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? "This system cannot list its drives." });
      if (r.status === 403) return setS({ error: "Files was not allowed to see the drives of this computer." });
      const d = (await r.json()) as { drives?: Drive[] };
      if (!r.ok || !Array.isArray(d.drives)) throw new Error("no host");
      setS({ drives: d.drives, sample: false });
    } catch {
      setS({ drives: SAMPLE, sample: true });
    }
  };
  useEffect(() => void (on && load()), [on]); // a look each time the category is opened
  return s;
}

const kind = (d: Drive) => (d.removable ? "Removable" : d.rotational ? "Hard disk" : "Solid state");

function Bar({ used, size }: { used: number | null; size: number }) {
  if (used === null || !size) return <span className="muted">Not mounted</span>;
  const pct = Math.min(100, Math.round((used / size) * 100));
  return (
    <>
      <div className="bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Space used"><span style={{ width: pct + "%" }} data-high={pct >= 90 ? "" : undefined} /></div>
      <span className="muted">{formatSize(size - used)} free of {formatSize(size)}</span>
    </>
  );
}

export function DrivesView({ state }: { state: State }) {
  if (!state) return <p className="empty">Looking for drives…</p>;
  if ("error" in state) return <p className="empty">{state.error}</p>;
  if (!state.drives.length) return <p className="empty">No drives were found.</p>;
  return (
    <div className="drives">
      {state.sample && <p className="sample">Sample data: this page is not running on BrasOS.</p>}
      {state.drives.map((d) => (
        <section key={d.path} className="drive" aria-label={d.model || d.path}>
          <header>
            <Icon name="disk" size={28} />
            <div>
              <h3>{d.model || d.path}</h3>
              <p className="muted">{d.path} · {formatSize(d.size)} · {kind(d)}</p>
            </div>
          </header>
          {d.volumes.length ? (
            <ul>
              {d.volumes.map((v) => (
                <li key={v.name}>
                  <div className="vol"><strong>{v.label || v.name}</strong><span className="muted">{v.fs}{v.mount ? ` · ${v.mount}` : ""}</span></div>
                  <Bar used={v.used} size={v.size} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No volumes.</p>
          )}
        </section>
      ))}
      <p className="muted note">Drives are listed for information. Files opens only your home folder.</p>
    </div>
  );
}
