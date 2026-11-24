# SDK reference

`@brasos/sdk` is how a page talks to BrasOS. Inside BrasOS every call goes to the host, which checks the app's permissions. Anywhere else (a normal browser) each call degrades to a **polyfill**, so the same code still runs.

```ts
import { os } from "@brasos/sdk";
```

As a plain script on any page inside BrasOS: `<script src="/__brasos/sdk.js"></script>` exposes `window.brasos`.

## API

| Call | Permission | Outside BrasOS |
|---|---|---|
| `os.available` | none | `false` |
| `await os.info()` | none | `{ os: null, packages: [] }` |
| `await os.apps.list()` | `apps.read` | `[]` |
| `await os.apps.open(id, { url? })` (`url`: only for `browser`, an http(s) address) | `apps.open` (checked by the shell) | `false` |
| `await os.apps.install(manifestUrl)` | `apps.install` (to ask; **you are always asked** and choose the permissions) | rejects `UnsupportedError` |
| `await os.apps.uninstall(id)` | `apps.uninstall` | rejects `UnsupportedError` |
| `await os.fs.list(path)` | `fs.read` | an in-memory file tree |
| `await os.fs.stat(path)` | `fs.read` | an in-memory file tree |
| `await os.fs.read(path, maxBytes?)` | `fs.read` | an in-memory file tree |
| `await os.fs.write(path, content, encoding?)` | `fs.write` | an in-memory file tree |
| `await os.fs.mkdir(path)` | `fs.write` | an in-memory file tree |
| `await os.fs.move(from, to)` | `fs.write` | an in-memory file tree |
| `await os.fs.remove(path)` | `fs.write` | an in-memory file tree |
| `await os.docs.list()` / `os.docs.page(slug)` | `docs.read` | rejects `UnsupportedError`, unless the page supplies the guides (Storybook does) |
| `os.db.collection(name, { space? })` → `put(doc, id?)`, `get(id)`, `list({ where, order, limit })`, `delete(id)` | `db.own` (`db.shared` for `space: "shared"`) | an in-memory store with the same events |
| `collection.watch(fn)` → unsubscribe | same | the in-memory store's events |
| `os.window.close()`, `.focus()`, `.minimize()`, `.toggleMaximize()`, `.setTitle(t)`, `.moveBy(dx, dy, at?)`, `.moveEnd()`, `.resize(w, h)`, `.watchMaximized(fn)` | `window.control` | `false` |
| `await os.web.open(url)` | `web.open` | `{ url, site }` with the URL unchanged |
| `os.tools.register(tool)` | none | does nothing without WebMCP |

The polyfill file tree starts with `/Desktop`, `/Documents` and `/Downloads` and follows the same rules as the real one (virtual paths, `..` collapses, delete goes to `/.trash`); it lives in memory and is gone on reload. A page can supply its own through `globalThis.__brasosPolyfill` (`{ fs, docs, standalone }`), which is how Storybook runs the apps.

A call the app has no permission for rejects with an `Error` whose message contains the HTTP status (`403`).

## The database

Documents are JSON, grouped in collections, and every change is an event, so apps can react to each other without polling:

```ts
const notes = os.db.collection("notes");              // private to this app
await notes.put({ title: "Buy milk", done: false });  // → { id, rev }
const open = await notes.list({ where: { done: false }, order: { field: "title" } });
const stop = notes.watch((e) => console.log(e.op, e.id, e.doc)); // put and delete, from any window or app
const chat = os.db.collection("chat", { space: "shared" });      // shared between apps that hold db.shared
```

The other side of a change gets it within milliseconds. Documents are capped at 256 KB and each app at 32 MB. See the database slice's README for the rules.

## Your own window

An app with `window.control` can move, resize, retitle and close its window (`os.window`). With `"window": { "frame": false }` in its manifest BrasOS draws no title bar, so the app draws one and uses `os.window.moveBy` from its own pointer events to drag.

## Files

Paths are virtual and absolute inside the user's home: `/Desktop/notes.txt`. `os.fs.read` returns `{ path, size, encoding, content, truncated }`: text comes back as `"utf8"`, anything else as `"base64"`. Reads are capped at 1 MiB, writes at 5 MiB. `os.fs.remove` moves to `/.trash`; `os.fs.trash()` lists it (each item with where it came from), `os.fs.restore(name)` puts one back, `os.fs.purge(name)` and `os.fs.emptyTrash()` delete for good. After a change the SDK tells the shell, so the desktop refreshes.

## Tools for AI agents

```ts
const off = os.tools.register({
  name: "notes_add",
  description: "Add a note",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  execute: async ({ text }) => ({ saved: text }),
});
```

This offers the tool to the browser's own agent through **WebMCP**, when the browser has it. WebMCP is still a draft and its API has already moved once, so registration is best-effort and never throws. For agents outside the browser, such as Claude Code, see [Agents](07-agents.md).

## Heartbeat

Importing the SDK makes the window answer the shell's `ping` with `pong`. You do not need to do anything else.
