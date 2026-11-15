import { Component, type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import type { AppInfo } from "@brasos/sdk";

// src is set for PWA windows: the gateway URL the host handed back for the app's start_url
type Win = { key: number; app: AppInfo; x: number; y: number; z: number; reload: number; src?: string };

// Fresh origin per restart => fresh renderer process (a hung process would otherwise be reused).
const appOrigin = (id: string, reload: number) =>
  `${location.protocol}//${id}${reload ? `--${reload}` : ""}.localhost${location.port ? `:${location.port}` : ""}`;
const frameSrc = (w: Win) => w.src ?? appOrigin(w.app.id, w.reload) + "/";

const post = (path: string, body: unknown) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// A window that throws while rendering must not take down the shell.
class Boundary extends Component<{ style: CSSProperties; onClose: () => void; children: ReactNode }, { err?: Error }> {
  state: { err?: Error } = {};
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <section className="window notice" style={this.props.style}>
        <p>Window crashed: {this.state.err.message}</p>
        <button onClick={this.props.onClose}>Close</button>
      </section>
    );
  }
}

// The iframe lives in its own process; the shell detects a hung/crashed app by missing pongs.
function Frame({ win, shield, onRestart, onClose }: { win: Win; shield: boolean; onRestart: () => void; onClose: () => void }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [hung, setHung] = useState(false);
  useEffect(() => {
    const origin = new URL(frameSrc(win)).origin;
    let last = Date.now();
    setHung(false);
    const onMsg = (e: MessageEvent) => {
      if (e.origin === origin && e.data === "pong") last = Date.now();
    };
    addEventListener("message", onMsg);
    const t = setInterval(() => {
      ref.current?.contentWindow?.postMessage("ping", origin);
      setHung(Date.now() - last > 8000);
    }, 2000);
    return () => {
      removeEventListener("message", onMsg);
      clearInterval(t);
    };
  }, [win.app.id, win.reload, win.src]);
  return (
    <>
      <iframe
        key={win.reload}
        ref={ref}
        onLoad={(e) => e.currentTarget.focus()}
        src={frameSrc(win)}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        style={{ pointerEvents: shield ? "none" : "auto" }}
      />
      {hung && (
        <div className="notice">
          <p>{win.app.name} isn't responding</p>
          <div>
            <button onClick={onRestart}>Restart</button> <button onClick={onClose}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}

function Shell() {
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [wins, setWins] = useState<Win[]>([]);
  const [dragging, setDragging] = useState(false);
  const [packages, setPackages] = useState<string[] | null>(null);
  const [note, setNote] = useState("");
  const seq = useRef(1);

  useEffect(() => {
    fetch("/os/apps").then((r) => r.json()).then(setApps);
    fetch("/os/info").then((r) => r.json()).then((i) => setPackages(i.packages));
    // Server restarted or failed over to the safe shell: reload so the UI isn't left dead.
    let down = false;
    const t = setInterval(async () => {
      try {
        await fetch("/os/info", { cache: "no-store" });
        if (down) location.reload();
      } catch {
        down = true;
      }
    }, 3000);
    return () => clearInterval(t);
  }, []);

  const open = async (app: AppInfo) => {
    let src: string | undefined;
    if (app.kind === "pwa") {
      // PWAs run on the web gateway: the host mints the (per-site) origin for the app's start URL
      const r = await post("/os/web/open", { url: app.start_url });
      if (!r.ok) return setNote(`Can't open ${app.name}: ${(await r.json().catch(() => ({}))).error ?? r.status}`);
      src = (await r.json()).url;
    }
    setNote("");
    const key = seq.current++;
    const z = seq.current++;
    setWins((w) => [...w, { key, app, x: 60 + 30 * w.length, y: 30 + 30 * w.length, z, reload: 0, src }]);
  };

  // an install/uninstall happened somewhere: refetch the list (a refetch is harmless, so no sender check)
  useEffect(() => {
    const onChanged = (e: MessageEvent) => e.data?.brasos === "apps-changed" && fetch("/os/apps").then((r) => r.json()).then(setApps);
    addEventListener("message", onChanged);
    return () => removeEventListener("message", onChanged);
  }, []);

  // An app asked (via @brasos/sdk apps.open) for the shell to open another app. UI-level only, so the shell checks the
  // permission itself against the registry; nothing privileged happens on the server.
  useEffect(() => {
    const onOpen = (e: MessageEvent) => {
      if (e.data?.brasos !== "open") return;
      const label = new URL(e.origin).hostname.replace(/\.localhost$/, "").split("--")[0];
      const from = apps.find((a) => a.id === label);
      const target = apps.find((a) => a.id === e.data.id);
      if (from?.permissions.includes("apps.open") && target) open(target);
    };
    addEventListener("message", onOpen);
    return () => removeEventListener("message", onOpen);
  }, [apps]);
  const patch = (key: number, f: (w: Win) => Partial<Win>) =>
    setWins((ws) => ws.map((w) => (w.key === key ? { ...w, ...f(w) } : w)));
  const close = (key: number) => setWins((ws) => ws.filter((w) => w.key !== key));
  const focus = (key: number) => {
    const z = seq.current++;
    patch(key, () => ({ z }));
  };
  const topZ = Math.max(0, ...wins.map((w) => w.z));

  return (
    <>
      <div className="desktop">
        {wins.map((w) => {
          const pos = { left: w.x, top: w.y, zIndex: w.z };
          return (
            <Boundary key={w.key} style={pos} onClose={() => close(w.key)}>
              <section className="window" style={pos}>
                <header
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setDragging(true);
                    focus(w.key);
                  }}
                  onPointerMove={(e) =>
                    e.buttons && patch(w.key, (c) => ({ x: c.x + e.movementX, y: Math.max(0, c.y + e.movementY) }))
                  }
                  onPointerUp={() => setDragging(false)}
                >
                  <span>
                    {w.app.icon} {w.app.name}
                  </span>
                  <button onPointerDown={(e) => e.stopPropagation()} onClick={() => close(w.key)}>
                    ✕
                  </button>
                </header>
                <div className="body">
                  <Frame
                    win={w}
                    shield={dragging}
                    onRestart={() => patch(w.key, (c) => ({ reload: c.reload + 1 }))}
                    onClose={() => close(w.key)}
                  />
                  {/* clicks inside an iframe never reach us, so unfocused windows get a click-catcher */}
                  {w.z !== topZ && <div className="shield" onPointerDown={() => focus(w.key)} />}
                </div>
              </section>
            </Boundary>
          );
        })}
      </div>
      <nav className="dock">
        {apps.map((a) => (
          <button key={a.id} onClick={() => open(a)}>
            {a.icon} {a.name}
          </button>
        ))}
        {/* nobody should mistake a dev image for a hardened one */}
        {note && <span className="badge">{note}</span>}
        {packages && !packages.includes("hardened") && <span className="badge">DEV · hardened package off · not secure</span>}
      </nav>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Shell />);
