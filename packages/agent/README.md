# agent

The agent interface: lets an AI agent drive BrasOS with typed tools instead of screenshots. User-facing description: [`docs/guide/07-agents.md`](../../docs/guide/07-agents.md).

## What it provides

- **An MCP server** at `POST /mcp` (JSON-RPC 2.0 over HTTP): `initialize`, `ping`, `tools/list`, `tools/call`. Responses are plain JSON (no streaming); `GET` is 405.
- **Host tools** from any slice's `Slice.tools` (today `fs_*`).
- **UI tools** from the shell: the shell opens a WebSocket at `/os/agent/ui` and registers them (`ui_snapshot`, `windows_focus`, `windows_close`, `apps_open`); the host relays `tools/call` to it and the answer back (10 s timeout). A host tool with the same name always wins.
- **Argument validation** (`src/validate.ts`) against the schema subset the tools publish.

## Safety

- **Token.** `agent.token` in the state dir, created on first start with mode 0600; compared in constant time. Delete it and restart to rotate.
- **Never a browser.** Any request with an `Origin` header is refused (even with the right token), so web pages can't be the agent. The UI relay is same-origin to the shell only.
- **Capabilities.** `agent.call` to use the endpoint at all; each tool's own capability against the agent's allow-list (`apps.read`, `fs.read`, `fs.write`, `docs.read`, `ui.control`) and the enabled packages' policies. The hardened package denies all of it.
- **Audit.** `agent.auth` (denials), the capability decisions, and `agent.tool` (name, success, duration). **Tool arguments are never written to the trail.**
- **Bounded.** Outputs over 256 KiB are truncated; at most 100 UI tools; names must match `[A-Za-z0-9_-]{1,64}`.

## Limits

Only the shell's UI tools and the slices' host tools are exposed; apps can't yet register their own tools through the shell. One UI connection at a time (a new one replaces the old). Tool errors are reported to the agent as `isError` results; unknown tools and bad arguments as JSON-RPC errors.

Tests: `test/agent.test.ts` (protocol, auth, browser refusal, calls, relay, audit, argument leakage). Benchmarks: `bench.ts`.
