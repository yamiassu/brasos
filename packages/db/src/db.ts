// The OS database: one SQLite file, documents in collections, and change events so apps can react to each other's writes.
//
//   own space    private to the caller (an app id, an installed PWA's id, or the shell). Capability `db.own`.
//   shared space readable and writable by every holder of `db.shared`: the place apps agree to exchange data. Capability `db.shared`.
//
// Apps never write SQL: a request names a collection and sends JSON, so a hostile app can't reach another app's rows, the
// schema, or SQLite's own tables. Reactivity is a Server-Sent Events stream (`GET /os/db/events`) that carries only events the
// caller may read. Every write is a change event; there is no way to write without one.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { json, type AuditFn, type Slice, type Target } from "@brasos/host/types";

export type DbEvent = { op: "put" | "delete"; ns: string; space: "own" | "shared"; col: string; id: string; rev: number; doc?: unknown };

const NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const MAX_DOC = 256 * 1024;
const QUOTA = 32 * 1024 * 1024; // bytes of documents per namespace
const INLINE = 16 * 1024; // events carry the document itself up to this size

class Bad extends Error {
  constructor(m: string, readonly status = 400) {
    super(m);
  }
}
const need = (ok: unknown, m: string, status = 400): void => {
  if (!ok) throw new Bad(m, status);
};

export function createDb({ stateDir, audit, ownerOf }: { stateDir?: string; audit: AuditFn; ownerOf: (caller: Target) => string | null }) {
  let db: Database | undefined;
  const open = () => {
    if (db) return db;
    if (stateDir) mkdirSync(join(stateDir, "db"), { recursive: true, mode: 0o700 });
    db = new Database(stateDir ? join(stateDir, "db", "brasos.sqlite") : ":memory:", { create: true });
    db.run("PRAGMA journal_mode = WAL");
    db.run("CREATE TABLE IF NOT EXISTS docs (ns TEXT NOT NULL, col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, rev INTEGER NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (ns, col, id)) WITHOUT ROWID");
    return db;
  };

  const bytes = new Map<string, number>(); // documents' size per namespace, loaded on first write
  const used = (ns: string) => {
    if (!bytes.has(ns)) bytes.set(ns, (open().query("SELECT COALESCE(SUM(length(data)), 0) AS n FROM docs WHERE ns = ?").get(ns) as { n: number }).n);
    return bytes.get(ns)!;
  };

  type Sub = { ns: string; col?: string; send(e: DbEvent): void };
  const subs = new Set<Sub>();
  const emit = (e: DbEvent) => subs.forEach((s) => s.ns === e.ns && (!s.col || s.col === e.col) && s.send(e));

  const put = (ns: string, space: "own" | "shared", col: string, id: string, doc: unknown) => {
    const data = JSON.stringify(doc);
    need(data !== undefined && data.length <= MAX_DOC, `document too large (max ${MAX_DOC} bytes)`, 413);
    const d = open();
    const old = d.query("SELECT length(data) AS n, rev FROM docs WHERE ns = ? AND col = ? AND id = ?").get(ns, col, id) as { n: number; rev: number } | null;
    need(used(ns) - (old?.n ?? 0) + data.length <= QUOTA, "storage quota exceeded", 413);
    const rev = (old?.rev ?? 0) + 1;
    d.query("INSERT INTO docs (ns, col, id, data, rev, ts) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (ns, col, id) DO UPDATE SET data = excluded.data, rev = excluded.rev, ts = excluded.ts").run(ns, col, id, data, rev, Date.now());
    bytes.set(ns, used(ns) - (old?.n ?? 0) + data.length);
    emit({ op: "put", ns, space, col, id, rev, ...(data.length <= INLINE ? { doc } : {}) });
    return { id, rev };
  };
  const row = (r: { id: string; data: string; rev: number; ts: number }) => ({ id: r.id, rev: r.rev, ts: r.ts, doc: JSON.parse(r.data) });

  /** who is asking and which namespace they mean, after the capability for that space allowed it */
  const resolve = (ctx: Parameters<NonNullable<Slice["handle"]>>[1], space: unknown, write: boolean) => {
    need(space === undefined || space === "own" || space === "shared", "space must be own or shared");
    const sp: "own" | "shared" = space === "shared" ? "shared" : "own";
    const g = ctx.gate(sp === "shared" ? "db.shared" : "db.own", { quiet: !write });
    if (!g.ok) return { res: g.res } as const;
    const owner = ownerOf(g.caller);
    if (sp === "own" && !owner) return { res: json({ error: "unknown caller" }, 403) } as const;
    return { ns: sp === "shared" ? "shared" : owner!, space: sp } as const;
  };

  const slice: Slice = {
    name: "db",
    async handle(req, ctx) {
      const p = ctx.url.pathname;
      if (ctx.target.kind !== "shell" || !p.startsWith("/os/db/")) return;
      try {
        if (req.method === "GET" && p === "/os/db/events") {
          const space = ctx.url.searchParams.get("space") ?? "own";
          const col = ctx.url.searchParams.get("col") ?? undefined;
          need(col === undefined || NAME.test(col), "invalid collection");
          const r = resolve(ctx, space, false);
          if ("res" in r) return r.res;
          let sub: Sub, beat: ReturnType<typeof setInterval>;
          const enc = new TextEncoder();
          const stream = new ReadableStream({
            start(c) {
              sub = { ns: r.ns, col, send: (e) => c.enqueue(enc.encode(`data: ${JSON.stringify({ op: e.op, space: e.space, col: e.col, id: e.id, rev: e.rev, doc: e.doc })}\n\n`)) };
              subs.add(sub);
              c.enqueue(enc.encode("retry: 2000\n: open\n\n"));
              beat = setInterval(() => c.enqueue(enc.encode(": keep-alive\n\n")), 5000); // Bun closes idle connections after 10 s
            },
            cancel() {
              subs.delete(sub);
              clearInterval(beat);
            },
          });
          return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
        }
        if (req.method !== "POST") return;
        const b: any = (await req.json().catch(() => null)) ?? {};
        // the gate (inside `resolve`) comes before any validation: a caller with no right learns nothing about the request format
        const col = () => (need(typeof b.col === "string" && NAME.test(b.col), "invalid collection"), b.col as string);

        if (p === "/os/db/put") {
          const r = resolve(ctx, b.space, true);
          if ("res" in r) return r.res;
          col();
          const id = b.id === undefined ? crypto.randomUUID() : b.id;
          need(typeof id === "string" && NAME.test(id), "invalid id");
          need("doc" in b, "missing doc");
          return json(put(r.ns, r.space, b.col, id, b.doc));
        }
        if (p === "/os/db/get") {
          const r = resolve(ctx, b.space, false);
          if ("res" in r) return r.res;
          col();
          need(typeof b.id === "string" && NAME.test(b.id), "invalid id");
          const x = open().query("SELECT id, data, rev, ts FROM docs WHERE ns = ? AND col = ? AND id = ?").get(r.ns, b.col, b.id) as any;
          return x ? json(row(x)) : json({ error: "not found" }, 404);
        }
        if (p === "/os/db/list") {
          const r = resolve(ctx, b.space, false);
          if ("res" in r) return r.res;
          col();
          const where: [string, unknown][] = Object.entries(b.where ?? {});
          need(where.length <= 8, "too many conditions");
          for (const [k, v] of where) need(FIELD.test(k) && (v === null || ["string", "number", "boolean"].includes(typeof v)), "where takes field names and plain values");
          const dir = b.order?.dir === "desc" ? "DESC" : "ASC";
          if (b.order) need(typeof b.order.field === "string" && FIELD.test(b.order.field), "invalid order field");
          const limit = Math.min(Math.max(Number.isInteger(b.limit) ? b.limit : 100, 1), 1000);
          const sql =
            "SELECT id, data, rev, ts FROM docs WHERE ns = ? AND col = ?" +
            where.map(([, v]) => (v === null ? " AND json_extract(data, ?) IS NULL" : " AND json_extract(data, ?) = ?")).join("") +
            (b.order ? ` ORDER BY json_extract(data, ?) ${dir}, id` : " ORDER BY id") +
            " LIMIT ?";
          const args: unknown[] = [r.ns, b.col];
          for (const [k, v] of where) v === null ? args.push(`$.${k}`) : args.push(`$.${k}`, typeof v === "boolean" ? (v ? 1 : 0) : v);
          if (b.order) args.push(`$.${b.order.field}`);
          args.push(limit);
          return json({ items: (open().query(sql).all(...(args as any[])) as any[]).map(row) });
        }
        if (p === "/os/db/delete") {
          const r = resolve(ctx, b.space, true);
          if ("res" in r) return r.res;
          col();
          need(typeof b.id === "string" && NAME.test(b.id), "invalid id");
          const old = open().query("SELECT length(data) AS n, rev FROM docs WHERE ns = ? AND col = ? AND id = ?").get(r.ns, b.col, b.id) as { n: number; rev: number } | null;
          if (!old) return json({ ok: true, existed: false });
          open().query("DELETE FROM docs WHERE ns = ? AND col = ? AND id = ?").run(r.ns, b.col, b.id);
          bytes.set(r.ns, used(r.ns) - old.n);
          emit({ op: "delete", ns: r.ns, space: r.space, col: b.col, id: b.id, rev: old.rev + 1 });
          return json({ ok: true, existed: true });
        }
      } catch (e) {
        if (e instanceof Bad) return json({ error: e.message }, e.status);
        audit("db.error", "deny", {}, { reason: String((e as Error).message).slice(0, 100) }, { key: "db-error", ms: 10_000 });
        return json({ error: "database error" }, 500);
      }
    },
  };
  return { slice, close: () => (subs.clear(), db?.close()) };
}
