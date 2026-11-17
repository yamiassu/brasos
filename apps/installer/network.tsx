// The installer's first screen: get online (a cable connects by itself; Wi-Fi is picked here), and, when the update server answers,
// ask whether to install the newest build directly instead of the one on this stick. Skippable: the stick installs without a network.
import { useCallback, useEffect, useState } from "react";
import { Button } from "@brasos/ui";

export type Net = { available: boolean; connected: boolean; wifi: { ssid: string; signal: number; secure: boolean; active: boolean }[]; latest: { version: string; notes: string } | null };

export function Network({ onDone }: { onDone: (latest: boolean) => void }) {
  const [net, setNet] = useState<Net | null>(null);
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [useLatest, setUseLatest] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/network", { cache: "no-store" });
      setNet(r.ok ? await r.json() : { available: false, connected: false, wifi: [], latest: null });
    } catch {
      setNet({ available: false, connected: false, wifi: [], latest: null });
    }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000); // a cable plugged in, or a Wi-Fi list that was still scanning
    return () => clearInterval(t);
  }, [load]);

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r = await fetch("/network/connect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ssid, password }) }).catch(() => null);
    if (r?.ok) setPassword("");
    else setError(((await r?.json().catch(() => null)) as { error?: string } | null)?.error ?? "could not connect");
    setBusy(false);
    void load();
  };

  if (!net) return null;
  const picked = net.wifi.find((w) => w.ssid === ssid);
  return (
    <div className="setup">
      <form className="setup-card os-install" style={{ minHeight: 0, display: "block", padding: 32 }} onSubmit={connect} aria-label="Network">
        <p className="eyebrow">Before you start</p>
        <h1>Connect to the internet</h1>
        <p className="lead">Optional. BrasOS can install from this stick without a network. Online, you can install the newest build instead of the one on the stick.</p>

        {!net.available && <p className="note">This system cannot manage networks. Plug in a network cable, or continue without one.</p>}
        {net.available && (
          <>
            <p role="status"><b>{net.connected ? "Connected." : "Not connected."}</b> <span className="muted">{net.connected ? "A cable or Wi-Fi network is up." : "A network cable connects by itself; for Wi-Fi, choose a network below."}</span></p>
            {net.wifi.length === 0 && <p className="note">No Wi-Fi networks found (no adapter, or still scanning).</p>}
            {net.wifi.length > 0 && (
              <div role="radiogroup" aria-label="Wi-Fi networks" className="disks">
                {net.wifi.map((w) => (
                  <button key={w.ssid} type="button" role="radio" aria-checked={ssid === w.ssid} className="disk" onClick={() => (setSsid(w.ssid), setPassword(""), setError(""))}>
                    <div className="what"><b>{w.ssid}</b><small>{w.secure ? "Password protected" : "Open"} · signal {w.signal}%</small></div>
                    {w.active && <span className="pill ok">Connected</span>}
                  </button>
                ))}
              </div>
            )}
            {ssid && picked?.secure !== false && (
              <label style={{ display: "block", marginTop: 12 }}>Password for {ssid}
                <input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} style={{ display: "block", width: "100%", marginTop: 4 }} />
              </label>
            )}
            {error && <p role="alert" className="setup-error">{error}</p>}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <Button type="submit" disabled={busy || !ssid}>{busy ? "Connecting…" : "Connect"}</Button>
              <Button type="button" onClick={() => void load()}>Refresh</Button>
            </div>
          </>
        )}

        {net.connected && net.latest && (
          <fieldset style={{ marginTop: 20, border: 0, padding: 0 }}>
            <legend><b>Install the latest build?</b></legend>
            <p className="muted">The newest BrasOS is {net.latest.version}{net.latest.notes ? `: ${net.latest.notes}` : ""}. It is downloaded during the install (it takes longer than installing from the stick). If the download fails, the install continues with the version on the stick.</p>
            <label><input type="radio" name="latest" checked={useLatest} onChange={() => setUseLatest(true)} /> Yes, install the latest build</label><br />
            <label><input type="radio" name="latest" checked={!useLatest} onChange={() => setUseLatest(false)} /> No, install the version on this stick</label>
          </fieldset>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 24 }}>
          <Button type="button" variant="primary" onClick={() => onDone(net.connected && !!net.latest && useLatest)}>{net.connected ? "Continue" : "Continue without internet"}</Button>
        </div>
      </form>
    </div>
  );
}
