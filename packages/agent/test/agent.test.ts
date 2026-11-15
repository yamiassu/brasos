import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { testHost, type TestHost } from "../../host/src/testing";
import { validate } from "../src/validate";

let h: TestHost;
let token: string;
beforeAll(async () => {
  h = await testHost();
  token = readFileSync(join(h.stateDir, "agent.token"), "utf8").trim();
});
afterAll(() => h.stop());

let nextId = 1;
const rpc = (method: string, params?: unknown, headers: Record<string, string> = { authorization: `Bearer ${token}` }) =>
  h.at("localhost", "/mcp", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }) });
const call = async (name: string, args?: unknown) => (await (await rpc("tools/call", { name, arguments: args })).json()) as any;
const text = (r: any) => r.result.content[0].text as string;

test("the token is created once, 64 hex chars, in the state dir", () => {
  expect(token).toMatch(/^[0-9a-f]{64}$/);
});

test("initialize negotiates the protocol version and identifies the server", async () => {
  const r = await (await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } })).json();
  expect(r.result).toMatchObject({ protocolVersion: "2025-03-26", serverInfo: { name: "brasos" }, capabilities: { tools: {} } });
  expect((await (await rpc("initialize", { protocolVersion: "1999-01-01" })).json()).result.protocolVersion).toBe("2025-06-18");
});

test("notifications get 202 and no body; unknown methods are JSON-RPC errors", async () => {
  const note = await h.at("localhost", "/mcp", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  expect(note.status).toBe(202);
  expect((await (await rpc("nope/nope")).json()).error.code).toBe(-32601);
  expect((await (await rpc("ping")).json()).result).toEqual({});
});

test("tools/list describes tools with schemas and read-only/destructive hints", async () => {
  const { tools } = (await (await rpc("tools/list")).json()).result;
  const by = Object.fromEntries(tools.map((t: any) => [t.name, t]));
  for (const n of ["fs_list", "fs_read", "fs_write", "fs_mkdir", "fs_move", "fs_delete"]) expect(by[n]).toBeDefined();
  expect(by.fs_list.annotations).toEqual({ readOnlyHint: true, destructiveHint: false });
  expect(by.fs_delete.annotations).toEqual({ readOnlyHint: false, destructiveHint: true });
  expect(by.fs_read.inputSchema).toMatchObject({ type: "object", required: ["path"] });
});

test("authentication: no token, a wrong token and a browser Origin are all refused", async () => {
  expect((await rpc("ping", undefined, {})).status).toBe(401);
  expect((await rpc("ping", undefined, { authorization: "Bearer " + "0".repeat(64) })).status).toBe(401);
  expect((await rpc("ping", undefined, { authorization: `Bearer ${token}`, origin: "http://evil.com" })).status).toBe(403); // even with the right token
  expect((await rpc("ping", undefined, { authorization: `Bearer ${token}`, origin: h.origin("localhost") })).status).toBe(403);
  expect((await h.at("localhost", "/mcp", { headers: { authorization: `Bearer ${token}` } })).status).toBe(405);
  expect((await h.at("about.localhost", "/mcp", { method: "POST", headers: { authorization: `Bearer ${token}` } })).status).not.toBe(200); // only on the shell host
});

test("a tool call works end to end and validates its arguments", async () => {
  expect(text(await call("fs_write", { path: "/Documents/agent.txt", content: "from the agent" }))).toContain('"size":14');
  expect(JSON.parse(text(await call("fs_read", { path: "/Documents/agent.txt" }))).content).toBe("from the agent");
  expect((await call("fs_list", { path: "/Documents" })).result.isError).toBe(false);
  const err = (r: any) => r.error;
  expect(err(await call("fs_read", {})).code).toBe(-32602); // missing path
  expect(err(await call("fs_read", { path: 5 })).code).toBe(-32602);
  expect(err(await call("fs_read", { path: "/x", extra: 1 })).message).toContain("unknown argument");
  expect(err(await call("fs_read", { path: "/x", maxBytes: 0 })).message).toContain("out of range");
  expect(err(await call("no_such_tool", {})).message).toContain("unknown tool");
});

test("a failing tool is reported as a tool error, not a protocol error", async () => {
  const r = await call("fs_read", { path: "/Documents/does-not-exist" });
  expect(r.result.isError).toBe(true);
  expect(text(r)).toContain("not found");
});

test("the UI relay: the shell registers tools, the agent sees them and calls them", async () => {
  const noUi = await call("ui_snapshot", {});
  expect(noUi.error?.message).toContain("unknown tool"); // not registered yet

  const ws = new WebSocket(`ws://localhost:${h.port}/os/agent/ui`, { headers: { origin: h.origin("localhost") } } as any);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.type === "call") ws.send(JSON.stringify(m.tool === "ui_boom" ? { type: "result", id: m.id, ok: false, error: "window not found" } : { type: "result", id: m.id, ok: true, result: { windows: [{ id: 1, app: "files" }], saw: m.args } }));
  };
  ws.send(JSON.stringify({ type: "register", tools: [
    { name: "ui_snapshot", description: "state of the screen", inputSchema: { type: "object", properties: { verbose: { type: "boolean" } } }, readOnly: true },
    { name: "ui_boom", description: "always fails", inputSchema: { type: "object" } },
    { name: "bad name!", description: "ignored", inputSchema: { type: "object" } },
    { name: "fs_list", description: "must not shadow a host tool", inputSchema: { type: "object" } },
  ] }));
  await Bun.sleep(100);

  const names = (await (await rpc("tools/list")).json()).result.tools.map((t: any) => t.name);
  expect(names).toContain("ui_snapshot");
  expect(names).not.toContain("bad name!");
  expect(names.filter((n: string) => n === "fs_list").length).toBe(1); // the host's own tool wins

  expect(JSON.parse(text(await call("ui_snapshot", { verbose: true })))).toEqual({ windows: [{ id: 1, app: "files" }], saw: { verbose: true } });
  const boom = await call("ui_boom", {});
  expect(boom.result).toMatchObject({ isError: true });
  expect(text(boom)).toContain("window not found");

  ws.close();
  await Bun.sleep(100);
  expect((await call("ui_snapshot", {})).error.message).toContain("unknown tool"); // gone with the connection
});

test("other origins can't register UI tools", async () => {
  for (const origin of ["http://about.localhost:" + h.port, "http://evil.com"]) {
    const result = await new Promise<string>((resolve) => {
      const ws = new WebSocket(`ws://localhost:${h.port}/os/agent/ui`, { headers: { origin } } as any);
      ws.onopen = () => resolve("OPEN");
      ws.onerror = () => resolve("REFUSED");
      setTimeout(() => resolve("TIMEOUT"), 3000);
    });
    expect(result).toBe("REFUSED");
  }
});

test("everything the agent does is audited, and its arguments never are", () => {
  const e = h.events();
  expect(e.some((x) => x.event === "agent.auth" && x.outcome === "deny")).toBe(true);
  expect(e.some((x) => x.event === "capability.agent.call" && x.outcome === "allow")).toBe(true);
  expect(e.some((x) => x.event === "agent.tool" && x.detail.tool === "fs_write" && x.detail.ok === true)).toBe(true);
  expect(e.some((x) => x.event === "capability.fs.write" && x.actor.app === "agent" && x.outcome === "allow")).toBe(true);
  expect(h.lines.join("\n")).not.toContain("from the agent"); // the file's content
  expect(h.lines.join("\n")).not.toContain(token);
});

test("validate: the schema subset", () => {
  const s = { type: "object" as const, properties: { a: { type: "string" as const, enum: ["x", "y"] }, n: { type: "integer" as const, minimum: 1, maximum: 5 }, b: { type: "boolean" as const } }, required: ["a"] };
  expect(validate(s, { a: "x", n: 3, b: true })).toBeNull();
  expect(validate(s, undefined)).toContain("missing");
  expect(validate(s, { a: "z" })).toContain("one of");
  expect(validate(s, { a: "x", n: 1.5 })).toContain("integer");
  expect(validate(s, { a: "x", n: 9 })).toContain("range");
  expect(validate(s, { a: "x", b: "yes" })).toContain("boolean");
  expect(validate(s, [])).toContain("object");
  expect(validate({ type: "object" }, undefined)).toBeNull();
});
