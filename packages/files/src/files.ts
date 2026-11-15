// Files: a filesystem confined to one directory (the user's BrasOS home). Everything is addressed by virtual absolute
// paths ("/Desktop/notes.txt"); nothing outside the home is reachable, including through symlinks. Deleting moves to /.trash.
import { mkdirSync, realpathSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, posix, resolve, sep } from "node:path";
import { json, type Slice, type Tool } from "@brasos/host/types";

const MAX_READ = 1024 * 1024;
const MAX_WRITE = 5 * 1024 * 1024;
const MAX_ENTRIES = 5000;

export class FsError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export type FsEntry = { name: string; kind: "dir" | "file" | "link"; size: number; mtime: number };

export function createFiles(o: { home?: string }) {
  const root = o.home ? resolve(o.home) : undefined;
  let realRoot = "";
  if (root) {
    for (const d of ["", "Desktop", "Documents", "Downloads"]) mkdirSync(join(root, d), { recursive: true });
    realRoot = realpathSync(root);
  }

  const inside = (real: string) => real === realRoot || real.startsWith(realRoot + sep);

  /** virtual path -> absolute path, lexically inside the home. Rejects anything odd instead of trying to repair it. */
  function locate(path: unknown): { abs: string; virtual: string } {
    if (!root) throw new FsError("files are not available", 503);
    if (typeof path !== "string" || !path || path.length > 1024 || /[\0\\]/.test(path)) throw new FsError("invalid path");
    const virtual = posix.normalize("/" + path);
    if (virtual.split("/").some((s) => s.length > 255)) throw new FsError("name too long");
    return { abs: join(root, ...virtual.split("/").filter(Boolean)), virtual };
  }

  /** after the lexical check, make sure symlinks don't lead outside: the real location of the target (or of its parent) must be inside the home */
  async function confined(abs: string, mustExist: boolean) {
    try {
      if (!inside(await realpath(mustExist ? abs : dirname(abs)))) throw new FsError("outside the home directory", 403);
    } catch (e) {
      if (e instanceof FsError) throw e;
      throw new FsError("not found", 404);
    }
  }
  const existing = async (path: unknown) => {
    const p = locate(path);
    await confined(p.abs, true);
    return p;
  };
  const fresh = async (path: unknown) => {
    const p = locate(path);
    if (p.virtual === "/") throw new FsError("invalid path");
    await confined(p.abs, false);
    return p;
  };
  const exists = (abs: string) => lstat(abs).then(() => true, () => false);

  const entry = async (abs: string, name: string): Promise<FsEntry> => {
    const s = await lstat(abs);
    return { name, kind: s.isSymbolicLink() ? "link" : s.isDirectory() ? "dir" : "file", size: s.size, mtime: Math.round(s.mtimeMs) };
  };

  const ops = {
    async list(path: string) {
      const { abs, virtual } = await existing(path);
      if (!(await stat(abs)).isDirectory()) throw new FsError("not a directory");
      const names = (await readdir(abs)).filter((n) => !(virtual === "/" && n === ".trash")).slice(0, MAX_ENTRIES);
      const entries = await Promise.all(names.map((n) => entry(join(abs, n), n).catch(() => null)));
      return entries
        .filter((e): e is FsEntry => !!e)
        .sort((a, b) => Number(b.kind === "dir") - Number(a.kind === "dir") || a.name.localeCompare(b.name));
    },
    async stat(path: string) {
      const { abs, virtual } = await existing(path);
      return { path: virtual, ...(await entry(abs, basename(abs))) };
    },
    async read(path: string, maxBytes = MAX_READ) {
      const { abs, virtual } = await existing(path);
      const s = await stat(abs);
      if (!s.isFile()) throw new FsError("not a file");
      const limit = Math.min(Math.max(1, Math.floor(maxBytes)), MAX_READ);
      const buf = (await readFile(abs)).subarray(0, limit);
      let encoding: "utf8" | "base64" = "utf8";
      let content: string;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(buf);
      } catch {
        encoding = "base64";
        content = Buffer.from(buf).toString("base64");
      }
      return { path: virtual, size: s.size, encoding, content, truncated: s.size > limit };
    },
    async write(path: string, content: string, encoding: "utf8" | "base64" = "utf8") {
      const { abs, virtual } = await fresh(path);
      if (typeof content !== "string") throw new FsError("content must be a string");
      const data = encoding === "base64" ? Buffer.from(content, "base64") : Buffer.from(content, "utf8");
      if (data.length > MAX_WRITE) throw new FsError("file too large", 413);
      if (await exists(abs)) {
        await confined(abs, true); // an existing file may itself be a symlink pointing outside the home
        if ((await stat(abs)).isDirectory()) throw new FsError("is a directory", 409);
      }
      await writeFile(abs, data);
      return { path: virtual, size: data.length };
    },
    async mkdir(path: string) {
      const { abs, virtual } = await fresh(path);
      if (await exists(abs)) throw new FsError("already exists", 409);
      await mkdir(abs);
      return { path: virtual };
    },
    async move(from: string, to: string) {
      const src = await existing(from);
      const dst = await fresh(to);
      if (src.virtual === "/" || src.virtual === "/.trash") throw new FsError("can't move that");
      if (await exists(dst.abs)) throw new FsError("destination exists", 409);
      if (dst.abs.startsWith(src.abs + sep)) throw new FsError("can't move a folder into itself");
      await rename(src.abs, dst.abs);
      return { path: dst.virtual };
    },
    /** to the trash, not gone: /.trash/<timestamp>-<name> */
    async remove(path: string) {
      const { abs, virtual } = await existing(path);
      if (virtual === "/" || virtual === "/.trash" || virtual.startsWith("/.trash/")) throw new FsError("can't delete that");
      const trash = join(root!, ".trash");
      await mkdir(trash, { recursive: true });
      const target = `/.trash/${Date.now()}-${basename(abs)}`;
      await rename(abs, join(root!, ...target.split("/").filter(Boolean)));
      return { path: target };
    },
  };

  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const tools: Tool[] = root
    ? [
        { name: "fs_list", description: "List a folder in the user's home (virtual path like /Desktop).", capability: "fs.read", readOnly: true,
          inputSchema: { type: "object", properties: { path: { type: "string", description: "Folder, e.g. /Documents" } }, required: ["path"] },
          run: (a) => ops.list(a.path) },
        { name: "fs_read", description: "Read a file (text, or base64 if binary). Large files are truncated to maxBytes (max 1 MiB).", capability: "fs.read", readOnly: true,
          inputSchema: { type: "object", properties: { path: { type: "string" }, maxBytes: { type: "integer", minimum: 1, maximum: MAX_READ } }, required: ["path"] },
          run: (a) => ops.read(a.path, a.maxBytes) },
        { name: "fs_write", description: "Create or overwrite a file. The parent folder must exist.", capability: "fs.write", destructive: true,
          inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
          run: (a) => ops.write(a.path, a.content) },
        { name: "fs_mkdir", description: "Create a folder. The parent must exist.", capability: "fs.write",
          inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }, run: (a) => ops.mkdir(a.path) },
        { name: "fs_move", description: "Move or rename. The destination must not exist.", capability: "fs.write",
          inputSchema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] },
          run: (a) => ops.move(a.from, a.to) },
        { name: "fs_delete", description: "Move a file or folder to the trash (/.trash). Recoverable.", capability: "fs.write", destructive: true,
          inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }, run: (a) => ops.remove(a.path) },
      ]
    : [];

  const slice: Slice = {
    name: "files",
    tools,
    async handle(req, ctx) {
      if (ctx.target.kind !== "shell" || req.method !== "POST" || !ctx.url.pathname.startsWith("/os/fs/")) return;
      const op = ctx.url.pathname.slice("/os/fs/".length);
      const reads = ["list", "stat", "read"];
      if (!reads.includes(op) && !["write", "mkdir", "move", "delete"].includes(op)) return;
      const g = ctx.gate(reads.includes(op) ? "fs.read" : "fs.write", { quiet: reads.includes(op) });
      if (!g.ok) return g.res;
      const b = (await req.json().catch(() => null)) ?? {};
      try {
        const result =
          op === "list" ? await ops.list(b.path)
          : op === "stat" ? await ops.stat(b.path)
          : op === "read" ? await ops.read(b.path, b.maxBytes)
          : op === "write" ? await ops.write(b.path, b.content, b.encoding === "base64" ? "base64" : "utf8")
          : op === "mkdir" ? await ops.mkdir(b.path)
          : op === "move" ? await ops.move(b.from, b.to)
          : await ops.remove(b.path);
        if (!reads.includes(op)) ctx.audit("fs.change", "info", { app: g.caller.kind === "app" ? g.caller.id : g.caller.kind }, { op, path: str(b.path ?? b.from).slice(0, 200) });
        return json(result);
      } catch (e) {
        if (e instanceof FsError) return json({ error: e.message }, e.status);
        return json({ error: "operation failed" }, 500);
      }
    },
  };

  return { slice, ops, available: !!root };
}

export type Files = ReturnType<typeof createFiles>;
