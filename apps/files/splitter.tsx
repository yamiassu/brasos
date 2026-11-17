// A draggable divider between two panes. `side` is the pane it resizes: dragging right grows a "left" pane and shrinks a "right" one.
// Keyboard: focus it and use Left/Right (Shift for bigger steps).
import { useRef } from "react";

export function Splitter({ side, value, min, max, label, onChange }: { side: "left" | "right"; value: number; min: number; max: number; label: string; onChange(v: number): void }) {
  const drag = useRef<{ x: number; v: number } | null>(null);
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v))));
  const sign = side === "left" ? 1 : -1;
  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(e) => (e.preventDefault(), e.currentTarget.setPointerCapture(e.pointerId), (drag.current = { x: e.clientX, v: value }))}
      onPointerMove={(e) => drag.current && set(drag.current.v + sign * (e.clientX - drag.current.x))}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        set(value + sign * (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 48 : 16));
      }}
    />
  );
}
