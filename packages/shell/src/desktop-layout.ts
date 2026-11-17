// Where the desktop icons sit. The desktop is a grid of cells; an icon can be dragged to any free cell, and removed from the
// desktop (an app stays installed, it only stops being shown here). Kept in the shell's own localStorage: it is only a
// preference, never a security setting. Icons without a saved cell flow into the first free cell, top to bottom, then left to right.
export const CELL = 96;
export const GAP = 4;
export const PAD = 12;
export type Cell = { col: number; row: number };
export type Layout = { cells: Record<string, Cell>; hidden: string[] };

const KEY = "brasos.desktop";
const int = (n: unknown) => (typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 1000 ? n : null);

export function loadLayout(): Layout {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    const cells: Record<string, Cell> = {};
    for (const [k, c] of Object.entries(v.cells ?? {})) {
      const col = int((c as Cell)?.col), row = int((c as Cell)?.row);
      if (col !== null && row !== null) cells[k] = { col, row };
    }
    return { cells, hidden: Array.isArray(v.hidden) ? v.hidden.filter((x: unknown) => typeof x === "string") : [] };
  } catch {
    return { cells: {}, hidden: [] };
  }
}
export function saveLayout(l: Layout) {
  try {
    localStorage.setItem(KEY, JSON.stringify(l));
  } catch {} // private window or blocked storage: the arrangement just doesn't survive a reload
}

const id = (c: Cell) => c.col + "," + c.row;
/** how many cells fit in a column of this height (at least one) */
export const rowsFor = (height: number) => Math.max(1, Math.floor((height - PAD * 2 + GAP) / (CELL + GAP)));
export const pixel = (c: Cell) => ({ left: PAD + c.col * (CELL + GAP), top: PAD + c.row * (CELL + GAP) });
/** the cell under a point of the desktop (clamped to the grid) */
export const cellAt = (x: number, y: number, rows: number, cols: number): Cell => ({
  col: Math.min(cols - 1, Math.max(0, Math.floor((x - PAD) / (CELL + GAP)))),
  row: Math.min(rows - 1, Math.max(0, Math.floor((y - PAD) / (CELL + GAP)))),
});

/** the cells of every icon: saved ones that fit stay where they are, the rest take the first free cell in reading order */
export function arrange(keys: string[], cells: Record<string, Cell>, rows: number): Record<string, Cell> {
  const out: Record<string, Cell> = {};
  const taken = new Set<string>();
  for (const k of keys) {
    const c = cells[k];
    if (c && c.row < rows && !taken.has(id(c))) (out[k] = c, taken.add(id(c)));
  }
  let n = 0;
  for (const k of keys) {
    if (out[k]) continue;
    let c: Cell;
    do c = { col: Math.floor(n / rows), row: n++ % rows };
    while (taken.has(id(c)));
    out[k] = c;
    taken.add(id(c));
  }
  return out;
}

/** dropping on a taken cell: the nearest free one instead (the icon never lands on top of another) */
export function nearestFree(want: Cell, taken: Cell[], rows: number): Cell {
  const used = new Set(taken.map(id));
  for (let d = 0; ; d++)
    for (let dc = -d; dc <= d; dc++)
      for (let dr = -d; dr <= d; dr++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== d) continue;
        const c = { col: want.col + dc, row: want.row + dr };
        if (c.col >= 0 && c.row >= 0 && c.row < rows && !used.has(id(c))) return c;
      }
}
