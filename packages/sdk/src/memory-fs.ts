// The fs polyfill: the same API as os.fs, over an in-memory tree, so apps (and Storybook) run in a plain browser.
// Same rules as the host's files slice: virtual absolute paths, ".." collapses at the root, delete moves to /.trash.
// ponytail: memory only (gone on reload); back it with OPFS if a polyfilled app ever needs to keep files.
import type { FsEntry, TrashEntry } from "./index";

type Node = { kind: "dir"; mtime: number; kids: Map<string, Node> } | { kind: "file"; mtime: number; data: Uint8Array };

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });
const MAX_READ = 1024 * 1024;

const fail = (m: string): never => {
  throw new Error(m);
};

function norm(path: unknown): string[] {
  if (typeof path !== "string" || !path || /[\0\\]/.test(path)) return fail("invalid path");
  const out: string[] = [];
  for (const s of path.split("/")) s === ".." ? out.pop() : s && s !== "." && out.push(s);
  return out;
}
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** `seed`: path -> text for a file, or null for a folder ("/Desktop/hello.txt": "hi") */
export function createMemoryFs(seed: Record<string, string | null> = {}) {
  const root: Node = { kind: "dir", mtime: Date.now(), kids: new Map() };
  const walk = (parts: string[]) => parts.reduce<Node | undefined>((n, p) => (n?.kind === "dir" ? n.kids.get(p) : undefined), root);
  const need = (path: unknown) => {
    const parts = norm(path);
    return { parts, node: walk(parts) ?? fail("not found"), virtual: "/" + parts.join("/") };
  };
  const parentOf = (parts: string[]) => {
    if (!parts.length) return fail("invalid path");
    const p = walk(parts.slice(0, -1));
    return p?.kind === "dir" ? p : fail("not found");
  };
  const entry = (name: string, n: Node): FsEntry => ({ name, kind: n.kind === "dir" ? "dir" : "file", size: n.kind === "file" ? n.data.length : 0, mtime: n.mtime });

  const api = {
    async list(path: string): Promise<FsEntry[]> {
      const { node, parts } = need(path);
      if (node.kind !== "dir") return fail("not a directory");
      return [...node.kids]
        .filter(([n]) => !(parts.length === 0 && n === ".trash"))
        .map(([n, k]) => entry(n, k))
        .sort((a, b) => Number(b.kind === "dir") - Number(a.kind === "dir") || a.name.localeCompare(b.name));
    },
    async stat(path: string) {
      const { node, parts, virtual } = need(path);
      return { path: virtual, ...entry(parts.at(-1) ?? "", node) };
    },
    async read(path: string, maxBytes = MAX_READ) {
      const { node, virtual } = need(path);
      if (node.kind !== "file") return fail("not a file");
      const limit = Math.min(Math.max(1, Math.floor(maxBytes)), MAX_READ);
      const buf = node.data.subarray(0, limit);
      let encoding: "utf8" | "base64" = "utf8";
      let content: string;
      try {
        content = dec.decode(buf);
      } catch {
        encoding = "base64";
        content = b64(buf);
      }
      return { path: virtual, size: node.data.length, encoding, content, truncated: node.data.length > limit };
    },
    async write(path: string, content: string, encoding: "utf8" | "base64" = "utf8") {
      const parts = norm(path);
      const dir = parentOf(parts);
      const name = parts.at(-1)!;
      if (dir.kids.get(name)?.kind === "dir") return fail("is a directory");
      const data = encoding === "base64" ? unb64(content) : enc.encode(content);
      dir.kids.set(name, { kind: "file", mtime: Date.now(), data });
      return { path: "/" + parts.join("/"), size: data.length };
    },
    async mkdir(path: string) {
      const parts = norm(path);
      const dir = parentOf(parts);
      if (dir.kids.has(parts.at(-1)!)) return fail("already exists");
      dir.kids.set(parts.at(-1)!, { kind: "dir", mtime: Date.now(), kids: new Map() });
      return { path: "/" + parts.join("/") };
    },
    async move(from: string, to: string) {
      const src = need(from);
      const dst = norm(to);
      if (!src.parts.length || src.parts[0] === ".trash" && src.parts.length === 1) return fail("can't move that");
      if (dst.length > src.parts.length - 1 && src.parts.every((p, i) => dst[i] === p)) return fail("can't move a folder into itself");
      const dir = parentOf(dst);
      if (dir.kids.has(dst.at(-1)!)) return fail("destination exists");
      parentOf(src.parts).kids.delete(src.parts.at(-1)!);
      dir.kids.set(dst.at(-1)!, src.node);
      return { path: "/" + dst.join("/") };
    },
    async remove(path: string) {
      const { parts, virtual } = need(path);
      if (!parts.length || parts[0] === ".trash") return fail("can't delete that");
      if (!root.kids.has(".trash")) root.kids.set(".trash", { kind: "dir", mtime: Date.now(), kids: new Map() });
      const trash = root.kids.get(".trash") as Extract<Node, { kind: "dir" }>;
      let t = Date.now();
      while (trash.kids.has(`${t}-${parts.at(-1)}`)) t++;
      const target = `/.trash/${t}-${parts.at(-1)}`;
      await api.move(virtual, target);
      from.set(`${t}-${parts.at(-1)}`, virtual);
      return { path: target };
    },
    async trash(): Promise<TrashEntry[]> {
      const trash = root.kids.get(".trash");
      if (trash?.kind !== "dir") return [];
      return [...trash.kids]
        .map(([n, k]) => ({ ...entry(n, k), from: from.get(n) ?? null, deleted: Number(/^(\d+)-/.exec(n)?.[1] ?? k.mtime) }))
        .sort((a, b) => b.deleted - a.deleted);
    },
    async restore(name: string) {
      const trash = root.kids.get(".trash");
      if (typeof name !== "string" || name.includes("/") || trash?.kind !== "dir" || !trash.kids.has(name)) return fail("not found");
      const original = norm(from.get(name) ?? "/" + name.replace(/^\d+-/, ""));
      const dir = ensure(original.slice(0, -1));
      const base = original.at(-1)!;
      const dot = base.lastIndexOf(".");
      const [stem, ext] = dot > 0 ? [base.slice(0, dot), base.slice(dot)] : [base, ""];
      let pick = base;
      for (let i = 2; dir.kids.has(pick); i++) pick = `${stem} (${i})${ext}`;
      dir.kids.set(pick, trash.kids.get(name)!);
      trash.kids.delete(name);
      from.delete(name);
      return { path: "/" + [...original.slice(0, -1), pick].join("/") };
    },
    async purge(name?: string) {
      const trash = root.kids.get(".trash");
      if (trash?.kind !== "dir") return name === undefined ? { removed: 0 } : fail("not found");
      if (name === undefined) {
        const removed = trash.kids.size;
        trash.kids.clear();
        from.clear();
        return { removed };
      }
      if (!trash.kids.delete(name)) return fail("not found");
      from.delete(name);
      return { removed: 1 };
    },
  };
  const from = new Map<string, string>(); // trash name -> where it was deleted from

  const ensure = (parts: string[]) => {
    let d = root as Extract<Node, { kind: "dir" }>;
    for (const p of parts) {
      if (!d.kids.has(p)) d.kids.set(p, { kind: "dir", mtime: Date.now(), kids: new Map() });
      d = d.kids.get(p) as Extract<Node, { kind: "dir" }>;
    }
    return d;
  };
  for (const d of ["Desktop", "Documents", "Downloads"]) ensure([d]);
  for (const [path, content] of Object.entries(seed)) {
    const parts = norm(path);
    if (content === null) ensure(parts);
    else ensure(parts.slice(0, -1)).kids.set(parts.at(-1)!, { kind: "file", mtime: Date.now(), data: enc.encode(content) });
  }
  return api;
}

export type MemoryFs = ReturnType<typeof createMemoryFs>;
