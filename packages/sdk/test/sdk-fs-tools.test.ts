import { expect, test } from "bun:test";
import { createMemoryFs, createOS, UnsupportedError } from "../src/index";

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

test("outside BrasOS fs is an in-memory polyfill and never touches the network", async () => {
  const r = recorder();
  const os = createOS({ location: loc("example.com", ""), fetch: r.fetch });
  expect((await os.fs.list("/")).map((e) => e.name)).toEqual(["Desktop", "Documents", "Downloads"]);
  await os.fs.write("/Documents/a.txt", "hello");
  expect((await os.fs.read("/Documents/a.txt")).content).toBe("hello");
  await os.fs.mkdir("/Documents/sub");
  await os.fs.move("/Documents/a.txt", "/Documents/sub/b.txt");
  expect((await os.fs.list("/Documents")).map((e) => [e.name, e.kind])).toEqual([["sub", "dir"]]);
  await expect(os.fs.mkdir("/Documents/sub")).rejects.toThrow("already exists");
  await expect(os.fs.move("/Documents/sub", "/Documents/sub/in")).rejects.toThrow("into itself");
  expect((await os.fs.read("/../Documents/sub/b.txt")).size).toBe(5); // ".." collapses at the root
  const gone = await os.fs.remove("/Documents/sub/b.txt");
  expect(gone.path).toMatch(/^\/\.trash\/\d+-b\.txt$/);
  expect((await os.fs.list("/")).some((e) => e.name === ".trash")).toBe(false); // hidden like the real one
  expect((await os.fs.read(gone.path)).content).toBe("hello");
  await expect(os.fs.read("/nope")).rejects.toThrow("not found");
  expect(r.calls.length).toBe(0);
});

test("a page can supply its own fs and docs polyfill; without docs they are unsupported", async () => {
  const fs = createMemoryFs({ "/Desktop/seed.txt": "s" });
  const docs = { list: async () => [{ slug: "a", title: "A" }], page: async (slug: string) => ({ slug, title: "A", html: "<p>x</p>" }) };
  const os = createOS({ location: loc("example.com", ""), fetch: recorder().fetch, polyfill: () => ({ fs, docs }) });
  expect((await os.fs.list("/Desktop")).map((e) => e.name)).toEqual(["seed.txt"]);
  expect((await os.docs.page("a")).html).toBe("<p>x</p>");
  const bare = createOS({ location: loc("example.com", ""), fetch: recorder().fetch });
  await expect(bare.docs.list()).rejects.toBeInstanceOf(UnsupportedError);
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
