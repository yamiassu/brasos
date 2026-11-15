import { Component, type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import type { AppInfo } from "@brasos/sdk";
import { Button, palettes } from "@brasos/ui";

/** src is set for PWA windows (the gateway URL the host handed back); hash opens a built-in app at a place (e.g. Files at /Desktop) */
export type Win = { key: number; app: AppInfo; x: number; y: number; z: number; reload: number; src?: string; hash?: string };

// Fresh origin per restart => fresh renderer process (a hung process would otherwise be reused).
const appOrigin = (id: string, reload: number) =>
  `${location.protocol}//${id}${reload ? `--${reload}` : ""}.localhost${location.port ? `:${location.port}` : ""}`;
export const frameSrc = (w: Win) => w.src ?? appOrigin(w.app.id, w.reload) + "/" + (w.hash ? "#" + encodeURI(w.hash) : "");

// A window that throws while rendering must not take down the shell.
export class Boundary extends Component<{ style: CSSProperties; onClose: () => void; children: ReactNode }, { err?: Error }> {
  state: { err?: Error } = {};
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <section className="ui-window" style={this.props.style}>
        <div className="ui-notice">
          <p>Window crashed: {this.state.err.message}</p>
          <Button onClick={this.props.onClose}>Close</Button>
        </div>
      </section>
    );
  }
}

// The iframe lives in its own process; the shell detects a hung/crashed app by missing pongs.
export function Frame({ win, palette, shield, onRestart, onClose }: { win: Win; palette?: string; shield: boolean; onRestart: () => void; onClose: () => void }) {
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
        title={win.app.name}
        onLoad={(e) => {
          e.currentTarget.focus();
          // built-in apps follow the user's accent color; websites are never told anything
          if (!win.src && palette) e.currentTarget.contentWindow?.postMessage({ brasos: "prefs", vars: (palettes as Record<string, { vars: object }>)[palette]?.vars ?? {} }, new URL(frameSrc(win)).origin);
        }}
        src={frameSrc(win)}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        style={{ pointerEvents: shield ? "none" : "auto" }}
      />
      {hung && (
        <div className="ui-notice" role="alert">
          <p>{win.app.name} isn't responding</p>
          <div>
            <Button onClick={onRestart}>Restart</Button> <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      )}
    </>
  );
}
