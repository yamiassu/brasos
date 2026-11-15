# db

The OS database: one SQLite file (`<state>/db/brasos.sqlite`, WAL), JSON documents in collections, and **change events** so apps can react to each other.

- **Spaces**: `own` is private to the caller (a built-in app's id, an installed PWA's id, or `shell`); capability `db.own`. `shared` is one space every holder of `db.shared` can read and write: where apps agree to exchange data.
- **No SQL from apps.** A request names a collection and sends JSON, so an app can't reach another's rows, the schema or SQLite's tables. `list` takes equality filters on top-level fields (`where`), one `order` and a `limit` (max 1000), compiled to parameterised `json_extract`. Names are `[A-Za-z0-9._:-]`, fields `[A-Za-z_][A-Za-z0-9_]*`.
- **Routes** (shell origin; apps and installed PWAs call them cross-origin, identified by `Origin`): `POST /os/db/put|get|list|delete` with `{ space?, col, ... }`, and `GET /os/db/events?space=&col=` (Server-Sent Events). The gate runs before any validation.
- **Reactivity**: every `put` and `delete` is an event `{ op, space, col, id, rev, doc? }` (the document is inline up to 16 KB). A stream gets only events of the namespace it may read, optionally one collection. The SDK wraps it: `os.db.collection("notes").watch(fn)`.
- **Limits**: 256 KB per document, 32 MB of documents per namespace, 429-free: a write over quota is a 413.
- **Who may**: the shell holds both capabilities. A built-in app lists them in its manifest; an installed PWA holds them only if the user granted them at install. A website that isn't an installed PWA holds nothing. The hardened package denies both (no database on that profile yet).
- Audit: the gate audits every allow and deny (`capability.db.own` / `capability.db.shared`; reads are throttled), and `db.error` records internal failures. Document contents are never audited.

Tests: `test/db.test.ts` (namespaces, validation, grants, streams, hardened). Benchmarks: `db.put`, `db.get`, `db.list_100`, `db.put_denied`.
