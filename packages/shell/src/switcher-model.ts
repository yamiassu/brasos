// Alt+Tab: which windows the switcher lists, in which order, and how a key press moves the selection. Pure, so it is tested without a browser.
export type SwItem = { id: string; kind: "pwa" | "native"; /** the window's key (pwa) or id (native) */ ref: number; title: string; icon: string; minimized: boolean };

type W = { key: number; z: number; title: string; icon: string; min?: boolean };
type N = { id: number; title: string; focused: boolean };

/**
 * The windows to cycle through, the one in front first (so the first Tab goes to the one behind it, like every desktop's Alt+Tab).
 * BrasOS windows come most recently used first (a window's z grows each time it gets the focus); minimized ones are listed too.
 * When a native window has the focus it is the one in front.
 */
export function switchItems(wins: W[], natives: N[], front: "pwa" | "native"): SwItem[] {
  const byZ = [...wins].sort((a, b) => b.z - a.z);
  const top = byZ.findIndex((w) => !w.min); // the window that has the focus, even when a minimized one has a higher z
  if (top > 0) byZ.unshift(...byZ.splice(top, 1));
  const pwa: SwItem[] = byZ.map((w) => ({ id: `w:${w.key}`, kind: "pwa", ref: w.key, title: w.title, icon: w.icon, minimized: !!w.min }));
  const nat: SwItem[] = natives.map((n) => ({ id: `n:${n.id}`, kind: "native", ref: n.id, title: n.title, icon: "app", minimized: false }));
  const nf = nat.findIndex((_, i) => natives[i].focused);
  if (front === "native" && nf >= 0) return [nat[nf], ...pwa, ...nat.filter((_, i) => i !== nf)];
  return [...pwa, ...nat];
}

/** the selection after a Tab (dir 1) or Shift+Tab (dir -1): wraps around */
export const stepIndex = (index: number, count: number, dir: 1 | -1) => (count <= 0 ? 0 : (((index + dir) % count) + count) % count);

/** Alt+Tab, and nothing else with it (Ctrl+Alt+Tab or Super+Tab are other keys) */
export const isSwitchKey = (e: { key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => e.key === "Tab" && !!e.altKey && !e.ctrlKey && !e.metaKey;
