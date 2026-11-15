import { expect, test } from "bun:test";
import { createOS, UnsupportedError } from "../src/index";

const recorder = (status = 200, body: unknown = { ok: true }) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch = async (url: string, init?: RequestInit) => (calls.push({ url, init }), new Response(JSON.stringify(body), { status }));
  return { calls, fetch };
};
const loc = (hostname: string, port = "7000") => ({ protocol: "http:", hostname, port });

test("fs calls POST to the host, and mutations tell the shell to refresh", async () => {
  const r = recorder(200, { path: "/Documents/a.txt", size: 2 });
  const sent: unknown[] = [];
  const os = createOS({ location: loc("files.localhost"), fetch: r.fetch, parent: { postMessage: (m) => sent.push(m) } });
  await os.fs.list("/Documents");
  await os.fs.read("/Documents/a.txt", 10);
  expect(sent).toEqual([]); // reads don't notify
  await os.fs.write("/Documents/a.txt", "hi");
  await os.fs.remove("/Documents/a.txt");
  expect(r.calls.map((c) => [c.url, c.init?.body])).toEqual([
    ["http://localhost:7000/os/fs/list", '{"path":"/Documents"}'],
    ["http://localhost:7000/os/fs/read", '{"path":"/Documents/a.txt","maxBytes":10}'],
    ["http://localhost:7000/os/fs/write", '{"path":"/Documents/a.txt","content":"hi","encoding":"utf8"}'],
    ["http://localhost:7000/os/fs/delete", '{"path":"/Documents/a.txt"}'],
  ]);
  expect(sent).toEqual([{ brasos: "fs-changed" }, { brasos: "fs-changed" }]);
});

test("installing still announces apps-changed", async () => {
  const sent: unknown[] = [];
  const os = createOS({ location: loc("browser.localhost"), fetch: recorder(200, { id: "pwa-1" }).fetch, parent: { postMessage: (m) => sent.push(m) } });
  await os.apps.install("https://example.com/m");
  expect(sent).toEqual([{ brasos: "apps-changed" }]);
});

test("outside BrasOS fs is unsupported and never touches the network", async () => {
  const r = recorder();
  const os = createOS({ location: loc("example.com", ""), fetch: r.fetch });
  await expect(os.fs.list("/")).rejects.toBeInstanceOf(UnsupportedError);
  await expect(os.fs.write("/x", "y")).rejects.toBeInstanceOf(UnsupportedError);
  expect(r.calls.length).toBe(0);
});

test("tools register with WebMCP when the browser has it, and unregister", async () => {
  const registered: any[] = [];
  let removed = "";
  const modelContext = { registerTool: (t: any) => (registered.push(t), { unregister: () => (removed = t.name) }) };
  const os = createOS({ location: loc("about.localhost"), fetch: recorder().fetch, modelContext: () => modelContext });
  const off = os.tools.register({ name: "ui_hello", description: "says hi", inputSchema: { type: "object" }, readOnly: true, execute: (a: any) => ({ hi: a.name }) });
  expect(registered[0]).toMatchObject({ name: "ui_hello", annotations: { readOnlyHint: true } });
  expect(JSON.parse((await registered[0].execute({ name: "bo" })).content[0].text)).toEqual({ hi: "bo" });
  off();
  expect(removed).toBe("ui_hello");
});

test("tools.register is a silent no-op without WebMCP, and never throws if WebMCP does", () => {
  const tool = { name: "t", description: "d", inputSchema: { type: "object" }, execute: () => 1 };
  expect(() => createOS({ fetch: recorder().fetch }).tools.register(tool)()).not.toThrow();
  expect(() => createOS({ fetch: recorder().fetch, modelContext: () => ({}) }).tools.register(tool)()).not.toThrow();
  const bad = { registerTool: () => { throw new Error("API changed"); } };
  expect(() => createOS({ fetch: recorder().fetch, modelContext: () => bad }).tools.register(tool)()).not.toThrow();
});
