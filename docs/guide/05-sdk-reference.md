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
| `await os.apps.open(id)` | `apps.open` (checked by the shell) | `false` |
| `await os.apps.install(manifestUrl)` | `apps.install` | rejects `UnsupportedError` |
| `await os.apps.uninstall(id)` | `apps.uninstall` | rejects `UnsupportedError` |
| `await os.fs.list(path)` | `fs.read` | rejects `UnsupportedError` |
| `await os.fs.stat(path)` | `fs.read` | rejects `UnsupportedError` |
| `await os.fs.read(path, maxBytes?)` | `fs.read` | rejects `UnsupportedError` |
| `await os.fs.write(path, content, encoding?)` | `fs.write` | rejects `UnsupportedError` |
| `await os.fs.mkdir(path)` | `fs.write` | rejects `UnsupportedError` |
| `await os.fs.move(from, to)` | `fs.write` | rejects `UnsupportedError` |
| `await os.fs.remove(path)` | `fs.write` | rejects `UnsupportedError` |
| `await os.docs.list()` / `os.docs.page(slug)` | `docs.read` | rejects `UnsupportedError` |
| `await os.web.open(url)` | `web.open` | `{ url, site }` with the URL unchanged |
| `os.tools.register(tool)` | none | does nothing without WebMCP |

A call the app has no permission for rejects with an `Error` whose message contains the HTTP status (`403`).

## Files

Paths are virtual and absolute inside the user's home: `/Desktop/notes.txt`. `os.fs.read` returns `{ path, size, encoding, content, truncated }`: text comes back as `"utf8"`, anything else as `"base64"`. Reads are capped at 1 MiB, writes at 5 MiB. `os.fs.remove` moves to `/.trash`. After a change the SDK tells the shell, so the desktop refreshes.

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
