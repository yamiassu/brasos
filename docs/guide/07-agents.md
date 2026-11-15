# Agents

An AI agent can drive BrasOS with **typed tools** instead of screenshots and mouse coordinates. One call returns the whole state of the screen, and each action is a single call with checked arguments. That is faster, cheaper and far less fragile than reading pixels.

## How agents connect

| Way | For | State |
|---|---|---|
| **MCP** (HTTP, `POST /mcp`) | Claude Code and any other MCP client, running inside or outside the OS | Works today |
| **WebMCP** | The browser's own built-in agent | Best-effort: it is a draft standard still in a browser trial, and its API has moved once. BrasOS offers the shell's tools to it when the browser has it |

Both expose the same tools from the same definitions, and both go through the same permission checks and audit trail.

## Connecting an MCP client

The endpoint is `http://localhost:7000/mcp` and it needs a bearer **token**: a file called `agent.token` in the state folder, readable only by the OS user.

| Where | Token file |
|---|---|
| Local development (`bun run dev`) | `.state/agent.token` |
| The dev image | `/var/lib/brasos/state/agent.token` |

For Claude Code, from a terminal on the same machine:

```
claude mcp add --transport http brasos http://localhost:7000/mcp --header "Authorization: Bearer $(cat /var/lib/brasos/state/agent.token)"
```

Check your client's documentation if its options differ. Delete the token file and restart to rotate the token.

## The tools

| Tool | What it does |
|---|---|
| `ui_snapshot` | The screen in one call: open windows (id, app, focused), the apps that can be opened, the desktop icons. **Call this first** |
| `windows_focus`, `windows_close` | Raise or close a window by id |
| `apps_open` | Open an app; for Files, `path` opens it at that folder or file |
| `fs_list`, `fs_read` | Look at the user's files |
| `fs_write`, `fs_mkdir`, `fs_move`, `fs_delete` | Change them (`fs_delete` moves to the trash) |

Each tool has a JSON schema and says whether it is read-only or destructive. Tools that act on the screen only work while the shell is open.

## What keeps this safe

- **Authenticated.** Without the token, the answer is 401.
- **Never from a web page.** Any request carrying a browser `Origin` header is refused, even with the right token, so no site can drive the OS.
- **Checked and recorded.** Every call is checked against what an agent may do and against the enabled packages, and is audited. The **arguments are never written to the audit trail**, so a file's contents do not leak into the log.
- **Off in the hardened image.** The `hardened` package refuses agents entirely, including the shell's connection.
- **Files stay inside the home.** An agent can reach no more of the disk than the Files app can.

An agent acts with the user's authority over their files. Treat the token like a password, and remember that anything an agent reads (a web page, a document) can try to instruct it.

## Adding a tool

Slices declare tools next to their routes (`Slice.tools`): a name, a description, an `inputSchema`, the capability it needs, and `run`. The agent slice exposes them automatically. See `packages/files/src/files.ts` for a complete example.
