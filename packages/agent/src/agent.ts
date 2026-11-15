// Agent interface: lets an AI agent drive BrasOS with typed tools instead of screenshots and coordinates.
//  - An MCP server (JSON-RPC over HTTP) at POST /mcp: initialize, tools/list, tools/call.
//  - Host tools come from the slices (`Slice.tools`); UI tools come from the shell, which connects a WebSocket
//    (/os/agent/ui) and registers them; calls to those are relayed to the shell and the answer relayed back.
// Security: callers authenticate with a bearer token kept in the state dir (readable only by the OS user), browsers are
// refused outright (any Origin header), every call is checked against the agent's capabilities and the enabled packages'
// policies (hardened denies agent.call entirely), and every call is audited. Tool arguments are never written to the trail.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { json, text, type Ctx, type JsonSchema, type Slice, type Tool } from "@brasos/host/types";
import { validate } from "./validate";

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const NAME = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_OUTPUT = 256 * 1024;
const UI_TIMEOUT_MS = 10_000;

export type AgentOptions = {
  /** host tools, read at call time so late-registered slices are included */
  tools: () => Tool[];
  /** where the token lives; without it the token is per-process (and so unknowable: tests only) */
  stateDir?: string;
  version?: string;
};

type UiTool = { name: string; description: string; inputSchema: JsonSchema; readOnly?: boolean; destructive?: boolean };

function loadToken(stateDir?: string): string {
  if (!stateDir) return randomBytes(32).toString("hex");
  const file = join(stateDir, "agent.token");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  mkdirSync(stateDir, { recursive: true });
  const token = randomBytes(32).toString("hex");
  writeFileSync(file, token, { mode: 0o600 });
  return token;
}

const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const rpcResult = (id: unknown, result: unknown) => json({ jsonrpc: "2.0", id, result });
const rpcError = (id: unknown, code: number, message: string) => json({ jsonrpc: "2.0", id, error: { code, message } });

export function createAgent(o: AgentOptions) {
  const token = loadToken(o.stateDir);
  let ui: { ws: any; tools: UiTool[] } | null = null;
  const pending = new Map<string, { resolve(v: unknown): void; reject(e: Error): void; timer: Timer }>();
  let seq = 0;

  function callUi(name: string, args: unknown): Promise<unknown> {
    if (!ui) return Promise.reject(new Error("no interface is connected (the shell isn't open)"));
    const id = String(++seq);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => (pending.delete(id), reject(new Error("the interface didn't answer in time"))), UI_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      ui!.ws.send(JSON.stringify({ type: "call", id, tool: name, args }));
    });
  }

  const hostTools = () => o.tools();
  const uiTools = () => (ui?.tools ?? []).filter((t) => !hostTools().some((h) => h.name === t.name));
  const describe = (t: { name: string; description: string; inputSchema: JsonSchema; readOnly?: boolean; destructive?: boolean }) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { readOnlyHint: !!t.readOnly, destructiveHint: !!t.destructive },
  });

  async function call(ctx: Ctx, name: string, args: unknown) {
    const host = hostTools().find((t) => t.name === name);
    const uiTool = host ? undefined : uiTools().find((t) => t.name === name);
    const tool = host ?? uiTool;
    if (!tool) return { error: { code: -32602, message: `unknown tool "${name}"` } };
    const bad = validate(tool.inputSchema, args);
    if (bad) return { error: { code: -32602, message: bad } };
    const capability = host ? host.capability : "ui.control";
    if (!ctx.allow(capability, "agent", { tool: name })) {
      return { result: { isError: true, content: [{ type: "text", text: `denied: this agent may not use "${name}" here` }] } };
    }
    const t0 = performance.now();
    let ok = true;
    let out: string;
    try {
      const value = host ? await host.run(args ?? {}) : await callUi(name, args ?? {});
      out = JSON.stringify(value ?? null);
      if (out.length > MAX_OUTPUT) out = JSON.stringify({ truncated: true, text: out.slice(0, MAX_OUTPUT) });
    } catch (e) {
      ok = false;
      out = (e as Error).message;
    }
    ctx.audit("agent.tool", "info", { app: "agent" }, { tool: name, ok, ms: Math.round(performance.now() - t0) });
    return { result: { isError: !ok, content: [{ type: "text", text: out }] } };
  }

  async function mcp(req: Request, ctx: Ctx): Promise<Response> {
    // a browser page can never be the agent: refuse anything that carries an Origin header (CSRF, hostile pages)
    if (req.headers.get("origin")) {
      ctx.audit("agent.auth", "deny", {}, { reason: "browser origin" }, { key: "agent-auth", ms: 5000 });
      return text("forbidden", 403);
    }
    const presented = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
    if (!safeEqual(presented, token)) {
      ctx.audit("agent.auth", "deny", {}, { reason: "bad or missing token" }, { key: "agent-auth", ms: 5000 });
      return new Response("unauthorized", { status: 401, headers: { "www-authenticate": "Bearer" } });
    }
    if (req.method !== "POST") return new Response("POST only", { status: 405, headers: { allow: "POST" } });
    if (!ctx.allow("agent.call", "agent")) return text("agents are disabled here", 403);

    const msg = await req.json().catch(() => null);
    if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(null, -32600, "invalid request");
    const { id, method, params } = msg;
    if (id === undefined) return new Response(null, { status: 202 }); // a notification (e.g. notifications/initialized)

    switch (method) {
      case "initialize":
        return rpcResult(id, {
          protocolVersion: PROTOCOLS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "brasos", version: o.version ?? "0.0.0" },
          instructions: "BrasOS: use ui_snapshot first for the state of the screen, then act with typed tools. Files live in the user's home (/Desktop, /Documents, /Downloads).",
        });
      case "ping":
        return rpcResult(id, {});
      case "tools/list":
        return rpcResult(id, { tools: [...hostTools(), ...uiTools()].map(describe) });
      case "tools/call": {
        const r = await call(ctx, String(params?.name), params?.arguments);
        return r.error ? rpcError(id, r.error.code, r.error.message) : rpcResult(id, r.result);
      }
      default:
        return rpcError(id, -32601, `method not found: ${method}`);
    }
  }

  const slice: Slice = {
    name: "agent",
    async handle(req, ctx) {
      if (ctx.target.kind !== "shell") return;
      if (ctx.url.pathname === "/mcp") return mcp(req, ctx);
      if (ctx.url.pathname === "/os/agent/ui") {
        // the shell connects here to expose its UI tools
        const g = ctx.gate("ui.host", { sameOrigin: true, quiet: true });
        if (!g.ok) return g.res;
        if (!ctx.upgrade("agent")) return text("upgrade failed", 400);
      }
    },
    ws: {
      open(ws) {
        ui?.ws.close();
        ui = { ws, tools: [] };
      },
      message(ws, raw) {
        if (ui?.ws !== ws) return;
        let m: any;
        try {
          m = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (m.type === "register" && Array.isArray(m.tools)) {
          ui.tools = m.tools
            .filter((t: any) => t && NAME.test(t.name) && typeof t.description === "string" && t.inputSchema?.type === "object")
            .slice(0, 100)
            .map((t: any) => ({ name: t.name, description: t.description.slice(0, 500), inputSchema: t.inputSchema, readOnly: !!t.readOnly, destructive: !!t.destructive }));
        } else if (m.type === "result" && pending.has(m.id)) {
          const p = pending.get(m.id)!;
          pending.delete(m.id);
          clearTimeout(p.timer);
          m.ok ? p.resolve(m.result) : p.reject(new Error(String(m.error ?? "failed").slice(0, 500)));
        }
      },
      close(ws) {
        if (ui?.ws !== ws) return;
        ui = null;
        for (const [id, p] of pending) (clearTimeout(p.timer), p.reject(new Error("the interface disconnected")), pending.delete(id));
      },
    },
  };

  return { slice, token };
}

export type Agent = ReturnType<typeof createAgent>;
