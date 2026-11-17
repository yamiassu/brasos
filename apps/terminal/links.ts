// Finding a web address in a line of terminal text, for Ctrl+click and Ctrl+right-click.
const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
/** trailing punctuation is part of the sentence, not of the address */
const trim = (u: string) => u.replace(/[.,;:!?)\]}]+$/, "");

/** the address that covers column `col` (0-based) of `line`, if any */
export function urlAt(line: string, col: number): string | null {
  for (const m of line.matchAll(URL_RE)) {
    const u = trim(m[0]);
    if (col >= m.index! && col < m.index! + u.length) return u;
  }
  return null;
}

/** the selected text, if it is just one web address */
export const urlOf = (selection: string): string | null => {
  const s = selection.trim();
  return /^https?:\/\/\S+$/.test(s) ? trim(s) : null;
};
