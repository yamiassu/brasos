import { Component, type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

type AppInfo = { id: string; name: string; icon: string };
type Win = { key: number; app: AppInfo; x: number; y: number; z: number; reload: number };

// Fresh origin per restart => fresh renderer process (a hung process would otherwise be reused).
const appOrigin = (id: string, reload: number) =>
  `${location.protocol}//${id}${reload ? `--${reload}` : ""}.localhost${location.port ? `:${location.port}` : ""}`;

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
    const origin = appOrigin(win.app.id, win.reload);
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
  }, [win.app.id, win.reload]);
  return (
    <>
      <iframe
        key={win.reload}
        ref={ref}
        onLoad={(e) => e.currentTarget.focus()}
        src={appOrigin(win.app.id, win.reload) + "/"}
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
  const seq = useRef(1);

  useEffect(() => {
    fetch("/api/apps").then((r) => r.json()).then(setApps);
    // Server restarted or failed over to the safe shell: reload so the UI isn't left dead.
    let down = false;
    const t = setInterval(async () => {
      try {
        await fetch("/api/apps", { cache: "no-store" });
        if (down) location.reload();
      } catch {
        down = true;
      }
    }, 3000);
    return () => clearInterval(t);
  }, []);

  const open = (app: AppInfo) => {
    const key = seq.current++;
    const z = seq.current++;
    setWins((w) => [...w, { key, app, x: 60 + 30 * w.length, y: 30 + 30 * w.length, z, reload: 0 }]);
  };
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
      </nav>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Shell />);
