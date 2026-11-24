// Pure helpers for the Trash app, tested without a browser.
import type { TrashEntry } from "@brasos/sdk";
import { baseName, parent } from "../files/paths";

/** the name the item had before it was deleted ("1712345678901-notes.txt" -> "notes.txt") */
export const originalName = (e: Pick<TrashEntry, "name" | "from">) => (e.from ? baseName(e.from) : e.name.replace(/^\d+-/, ""));

/** the folder it was deleted from, as shown to the person ("/Desktop", "Home" for the root, "Unknown" if not recorded) */
export const originalFolder = (e: Pick<TrashEntry, "from">) => (e.from === null ? "Unknown" : parent(e.from) === "/" ? "Home" : parent(e.from));

/** a case-insensitive filter on the original name and folder */
export const matches = (e: TrashEntry, q: string) => !q.trim() || `${originalName(e)} ${originalFolder(e)}`.toLowerCase().includes(q.trim().toLowerCase());

/** "Today 14:05", "Yesterday 09:12", or a date */
export function when(ms: number, now = Date.now()) {
  const d = new Date(ms);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date(now)) - day(d)) / 86400000);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return diff === 0 ? `Today ${time}` : diff === 1 ? `Yesterday ${time}` : d.toLocaleDateString();
}
