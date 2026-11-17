// Native (non-PWA) app windows, drawn as windows of the OS. The compositor owns the window's pixels and stacks them above the shell;
// the shell draws the frame (title bar, close, move, resize) and tells the compositor where the content goes (`place`).
// So a native app moves and closes like any other window, and the taskbar lists it.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { WindowFrame } from "@brasos/ui";

/** `ssd`: the shell draws the title bar (the app doesn't draw its own: Steam and most GTK/Qt/Electron apps do) */
export type NativeWin = { id: number; title: string; app: string; focused: boolean; w: number; h: number; ssd: boolean; x?: number; y?: number };
type Rect = { x: number; y: number; w: number; h: number };

const MIN_W = 240;
const MIN_H = 140;
const TASKBAR = 56; // a native window can't be put under the taskbar: the compositor draws it above the shell
const post = (path: string, body: unknown) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), keepalive: true }).catch(() => {});
// a drag changes the rectangle on every pointer event: send the newest one once per frame, never a queue of old ones
const pending = new Map<number, unknown>();
let scheduled = false;
const place = (id: number, body: unknown) => {
  pending.set(id, body);
  if (scheduled) return;
  scheduled = true;
  // a timer, not requestAnimationFrame: the browser may throttle frames for a surface the compositor covers
  setTimeout(() => {
    scheduled = false;
    for (const b of pending.values()) post("/os/native/place", b);
    pending.clear();
  }, 8);
};

function Framed({ win, rect, order, setRect, onFocus }: { win: NativeWin; rect: Rect; order: number; setRect(r: Rect): void; onFocus(): void }) {
  const body = useRef<HTMLDivElement>(null);
  const last = useRef("");
  // after every layout, say where the content is (only when it changed): the compositor places the real window there
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const m = { x: Math.round(r.left), y: Math.round(r.top), w: Math.max(64, Math.round(r.width)), h: Math.max(48, Math.round(r.height)) };
    const key = `${m.x},${m.y},${m.w},${m.h}`;
    if (key === last.current) return;
    last.current = key;
    place(win.id, { id: win.id, ...m });
  });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const vw = () => window.innerWidth;
  const vh = () => window.innerHeight;
  const clamp = (r: Rect): Rect => ({ ...r, x: Math.min(vw() - 80, Math.max(80 - r.w, r.x)), y: Math.min(vh() - TASKBAR - 40, Math.max(0, r.y)) });
  return (
    <div style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: 100 + order, pointerEvents: "auto", display: "flex" }}>
      <WindowFrame
        title={win.title || win.app || "Native app"}
        icon="app"
        focused={win.focused}
        onClose={() => post("/os/native/close", { id: win.id })}
        style={{ position: "relative", width: "100%", height: "100%" }}
        headerProps={{
          onPointerDown: (e) => ((e.currentTarget as HTMLElement).setPointerCapture(e.pointerId), (drag.current = { x: e.clientX, y: e.clientY }), onFocus()),
          onPointerMove: (e) => {
            if (!drag.current || !e.buttons) return;
            const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
            drag.current = { x: e.clientX, y: e.clientY };
            setRect(clamp({ ...rect, x: rect.x + dx, y: rect.y + dy }));
          },
          onPointerUp: () => ((drag.current = null), post("/os/native/focus", { id: win.id })),
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          {/* transparent: the app's real window is composited here */}
          <div ref={body} style={{ flex: 1, minHeight: 0 }} />
          <div
            title="Resize"
            style={{ height: 12, cursor: "nwse-resize", touchAction: "none", background: "var(--panel-2)", borderTop: "1px solid var(--border)" }}
            onPointerDown={(e) => ((e.currentTarget as HTMLElement).setPointerCapture(e.pointerId), (drag.current = { x: e.clientX, y: e.clientY }))}
            onPointerMove={(e) => {
              if (!drag.current || !e.buttons) return;
              const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
              drag.current = { x: e.clientX, y: e.clientY };
              setRect({ ...rect, w: Math.max(MIN_W, rect.w + dx), h: Math.max(MIN_H, rect.h + dy) });
            }}
            onPointerUp={() => (drag.current = null)}
          />
        </div>
      </WindowFrame>
    </div>
  );
}

export function NativeWindows({ natives }: { natives: NativeWin[] }) {
  const [rects, setRects] = useState<Record<number, Rect>>({});
  const [order, setOrder] = useState<number[]>([]); // least to most recently focused
  const count = useRef(0);
  // a new window gets a cascaded frame sized for its content (the app's own size, within the screen)
  useEffect(() => {
    setRects((old) => {
      let next = old;
      for (const n of natives) {
        if (old[n.id] || !n.ssd) continue;
        const k = count.current++ % 8;
        const w = Math.min(window.innerWidth - 40, Math.max(MIN_W, n.w || 640));
        const h = Math.min(window.innerHeight - TASKBAR - 80, Math.max(MIN_H, (n.h || 420) + 50));
        next = { ...next, [n.id]: { x: 40 + 30 * k, y: 20 + 30 * k, w, h } };
      }
      return next;
    });
  }, [natives]);
  // the focused window is the top one; a closed window leaves the order
  useEffect(() => {
    setOrder((o) => {
      const ids = natives.map((n) => n.id);
      const kept = o.filter((id) => ids.includes(id));
      const add = ids.filter((id) => !kept.includes(id));
      const f = natives.find((n) => n.focused)?.id;
      const all = [...kept, ...add];
      const next = f ? [...all.filter((id) => id !== f), f] : all;
      return next.join() === o.join() ? o : next;
    });
  }, [natives]);
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 800 }}>
      {natives.filter((n) => n.ssd).map((n) =>
        rects[n.id] ? (
          <Framed key={n.id} win={n} rect={rects[n.id]} order={order.indexOf(n.id)} setRect={(r) => setRects((s) => ({ ...s, [n.id]: r }))} onFocus={() => post("/os/native/focus", { id: n.id })} />
        ) : null,
      )}
    </div>
  );
}
