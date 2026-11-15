// Small pure helpers for the Files app (kept apart from the UI so they can be tested).
import type { FsEntry } from "@brasos/sdk";

export const join = (dir: string, name: string) => (dir === "/" ? "" : dir) + "/" + name;
export const parent = (path: string) => path.replace(/\/[^/]*$/, "") || "/";
export const baseName = (path: string) => path.split("/").filter(Boolean).pop() ?? "";

/** "a/b" or "" or "." are not names: a name is one path segment */
export const validName = (name: string) => name.trim() !== "" && !/[/\\\0]/.test(name) && name !== "." && name !== "..";

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) (v /= 1024), i++;
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

const TEXT = /\.(txt|md|json|ts|tsx|js|css|html|csv|log|toml|ya?ml|sh|nix)$/i;
const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
export const isText = (name: string) => TEXT.test(name);
export const isImage = (name: string) => IMAGE.test(name);
export const imageMime = (name: string) => ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" })[name.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";

export const iconFor = (e: FsEntry) => (e.kind === "dir" ? "folder" : e.kind === "link" ? "link" : isText(e.name) ? "text" : isImage(e.name) ? "image" : "file");

/** the starting place from a window hash such as "#/Documents/notes.txt": the folder to show and the file to select */
export function startFromHash(hash: string): { dir: string; select?: string } {
  let p = "/";
  try {
    p = decodeURIComponent(hash.replace(/^#/, "")) || "/";
  } catch {}
  if (!p.startsWith("/")) p = "/" + p;
  const last = baseName(p);
  return /\.[^/.]+$/.test(last) ? { dir: parent(p), select: last } : { dir: p === "" ? "/" : p.replace(/\/+$/, "") || "/" };
}
