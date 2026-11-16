// Window behaviors for apps that draw their own title bar (manifest `window: { frame: false }`, permission `window.control`).
// The shell does the window management (moving, restoring a maximized window under the pointer, the snap-to-top preview,
// minimize and maximize); an app only has to report its pointer. These pieces do that for you, so every frameless app
// behaves the same. They depend on no SDK: pass `os.window` from @brasos/sdk (it fits `WindowControls`).
//
//   const drag = useWindowDrag(os.window);
//   <div className="ui-titlebar" {...drag}> ...your tabs or title... <span className="ui-drag" /> <WindowButtons window={os.window} /> </div>
//
// or simply `<TitleBar window={os.window} title="Notes" />`.
import { type ReactNode, useMemo } from "react";
import { IconButton } from "./components";
import { Icon } from "./icons";

/** what an app's window can do; `os.window` from @brasos/sdk satisfies this */
export type WindowControls = {
  close(): unknown;
  minimize(): unknown;
  toggleMaximize(): unknown;
  moveBy(dx: number, dy: number, at?: { x: number; y: number }): unknown;
  moveEnd(): unknown;
  focus?(): unknown;
};

/** how far (px) the pointer must travel before a press on the bar is a drag: a click, or the first half of a double click, is not */
export const DRAG_THRESHOLD = 4;

type PointerLike = { target: any; currentTarget: any; clientX: number; clientY: number; movementX: number; movementY: number; button: number; pointerId: number };

/**
 * The drag logic as plain functions (the hook below wraps it). Pressing on the bar itself, or on anything with the class
 * `ui-drag`, starts a drag; buttons and tabs inside the bar are left alone. While dragging it reports the pointer's movement
 * (in this page's own pixels, which is what `moveBy` takes) and where the pointer is, so the shell can restore a maximized
 * window under the pointer and show the snap preview at the top edge; `moveEnd` on release drops it there.
 */
export function createWindowDrag(w: WindowControls) {
  let d: { x: number; y: number; on: boolean } | null = null;
  const onBar = (e: { target: any; currentTarget: any }) => e.target === e.currentTarget || !!e.target?.classList?.contains("ui-drag");
  const release = (e: PointerLike) => {
    try { if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  };
  return {
    onPointerDown(e: PointerLike) {
      w.focus?.();
      if (e.button !== 0 || !onBar(e)) return;
      d = { x: e.clientX, y: e.clientY, on: false };
      try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch {} // a pointer that is already gone can't be captured
    },
    onPointerMove(e: PointerLike) {
      if (!d) return;
      if (!d.on && Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_THRESHOLD) return;
      d.on = true;
      w.moveBy(e.movementX, e.movementY, { x: e.clientX, y: e.clientY });
    },
    onPointerUp(e: PointerLike) {
      if (d?.on) w.moveEnd();
      d = null;
      release(e);
    },
    onPointerCancel(e: PointerLike) {
      if (d?.on) w.moveEnd();
      d = null;
      release(e);
    },
    /** a double click on the bar maximizes, and restores */
    onDoubleClick(e: { target: any; currentTarget: any }) {
      if (onBar(e)) w.toggleMaximize();
    },
  };
}

/** the handlers to spread onto your title bar element */
export const useWindowDrag = (w: WindowControls) => useMemo(() => createWindowDrag(w), [w]);

/** minimize, maximize and close, in the same style as the shell's own window frame */
export function WindowButtons({ window: w }: { window: WindowControls }) {
  return (
    <span className="ui-winctl">
      <IconButton label="Minimize window" onClick={() => w.minimize()}>–</IconButton>
      <IconButton label="Maximize or restore window" onClick={() => w.toggleMaximize()}>□</IconButton>
      <IconButton label="Close window" onClick={() => w.close()}>✕</IconButton>
    </span>
  );
}

/** a complete title bar: icon and title (drag it, double click it), anything you put inside beside them, and the window buttons */
export function TitleBar({ window: w, title, icon, children }: { window: WindowControls; title: string; icon?: string; children?: ReactNode }) {
  const drag = useWindowDrag(w);
  return (
    <header className="ui-titlebar" {...drag}>
      <span className="ui-drag">{icon && <Icon name={icon} size={18} />}{title}</span>
      {children}
      <WindowButtons window={w} />
    </header>
  );
}
