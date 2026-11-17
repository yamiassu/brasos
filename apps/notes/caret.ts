// Where a textarea's caret is on screen, measured with a hidden copy of it (a textarea gives no caret coordinates).
// Used so Up and Down can tell the first and last visual line of a block, and keep the horizontal position across blocks.
export function caretBox(ta: HTMLTextAreaElement, pos: number): { top: number; left: number } {
  const cs = getComputedStyle(ta);
  const d = document.createElement("div");
  for (const p of ["font", "letterSpacing", "padding", "border", "boxSizing", "width", "lineHeight", "tabSize"] as const) d.style[p] = cs[p];
  Object.assign(d.style, { position: "absolute", visibility: "hidden", top: "0", left: "-9999px", whiteSpace: "pre-wrap", overflowWrap: "anywhere" });
  d.textContent = ta.value.slice(0, pos);
  const m = document.createElement("span");
  m.textContent = "​";
  d.append(m);
  document.body.append(d);
  const r = { top: m.offsetTop, left: m.offsetLeft };
  d.remove();
  return r;
}

/** the position on the block's first (dir 1: arrived going down) or last (dir -1) visual line whose x is closest to `x` */
export function posNear(ta: HTMLTextAreaElement, x: number, dir: -1 | 1): number {
  const len = ta.value.length;
  const rowTop = caretBox(ta, dir < 0 ? len : 0).top;
  let best = dir < 0 ? len : 0, bestD = Infinity;
  for (let p = 0; p <= len; p++) {
    const b = caretBox(ta, p);
    if (b.top !== rowTop) continue;
    const dx = Math.abs(b.left - x);
    if (dx < bestD) (bestD = dx, (best = p));
  }
  return best;
}
