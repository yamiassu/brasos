// What is pinned where. Stored as what was UNPINNED, so every app is pinned by default and a newly installed app shows
// up on its own. Kept in the shell's own localStorage; it is only a preference, never a security setting.
export type Where = "taskbar" | "start";
export type Unpinned = Record<Where, string[]>;

const KEY = "brasos.unpinned";
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

export function loadUnpinned(): Unpinned {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return { taskbar: list(v.taskbar), start: list(v.start) };
  } catch {
    return { taskbar: [], start: [] };
  }
}
export function saveUnpinned(u: Unpinned) {
  try {
    localStorage.setItem(KEY, JSON.stringify(u));
  } catch {} // private window or blocked storage: the choice just doesn't survive a reload
}
export const isPinned = (u: Unpinned, where: Where, id: string) => !u[where].includes(id);
export const setPinned = (u: Unpinned, where: Where, id: string, pinned: boolean): Unpinned => ({
  ...u,
  [where]: pinned ? u[where].filter((x) => x !== id) : [...new Set([...u[where], id])],
});
