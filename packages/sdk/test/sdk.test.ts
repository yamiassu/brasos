import { expect, test } from "bun:test";
import { createOS, UnsupportedError } from "../src/index";

const recorder = (status = 200, body: unknown = { ok: true }) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch = async (url: string, init?: RequestInit) => (calls.push({ url, init }), new Response(JSON.stringify(body), { status }));
  return { calls, fetch };
};
const loc = (hostname: string, port = "7000") => ({ protocol: "http:", hostname, port });

test("inside BrasOS calls go to the host on the shell origin, from any app origin", async () => {
  const r = recorder(200, []);
  const os = createOS({ location: loc("terminal.localhost"), fetch: r.fetch });
  expect(os.available).toBe(true);
  await os.apps.list();
  expect(r.calls[0].url).toBe("http://localhost:7000/os/apps");
});

test("inside BrasOS a gateway-served site also counts as inside", () => {
  expect(createOS({ location: loc("abc.web.localhost"), fetch: recorder().fetch }).available).toBe(true);
});

test("web.open POSTs JSON", async () => {
  const r = recorder(200, { url: "x", site: "y" });
  const os = createOS({ location: loc("browser.localhost"), fetch: r.fetch });
  await os.web.open("https://example.com/a");
  expect(r.calls.map((c) => [c.url, c.init?.method, c.init?.body])).toEqual([["http://localhost:7000/os/web/open", "POST", '{"url":"https://example.com/a"}']]);
});

/** a framing shell: records what the app posts and lets the test answer */
function shellOf() {
  const sent: any[] = [];
  const ls: ((e: { data: any; origin: string }) => void)[] = [];
  return {
    sent,
    env: { parent: { postMessage: (m: unknown) => void sent.push(m) }, listen: (fn: (e: { data: any; origin: string }) => void) => (ls.push(fn), () => void ls.splice(ls.indexOf(fn), 1)) },
    reply: (data: unknown, origin = "http://localhost:7000") => ls.slice().forEach((f) => f({ data, origin })),
    listeners: () => ls.length,
  };
}

test("apps.install asks the shell, which prompts the user; the answer comes back with the nonce", async () => {
  const sh = shellOf();
  const r = recorder();
  const os = createOS({ location: loc("browser.localhost"), fetch: r.fetch, ...sh.env });
  const p = os.apps.install("https://example.com/m.webmanifest");
  const ask = sh.sent[0];
  expect(ask).toMatchObject({ brasos: "install", manifestUrl: "https://example.com/m.webmanifest" });
  sh.reply({ brasos: "install-result", nonce: "wrong", app: { id: "x" } }); // another request's answer: ignored
  sh.reply({ brasos: "install-result", nonce: ask.nonce, app: { id: "pwa-1" } }, "http://evil.localhost:7000"); // not the shell: ignored
  expect(sh.listeners()).toBe(1);
  sh.reply({ brasos: "install-result", nonce: ask.nonce, app: { id: "pwa-1", permissions: ["db.own"] } });
  expect(await p).toMatchObject({ id: "pwa-1" });
  expect(sh.listeners()).toBe(0);
  expect(r.calls.length).toBe(0); // the app never calls the host's install route itself
  const q = os.apps.install("https://example.com/m2");
  sh.reply({ brasos: "install-result", nonce: sh.sent[1].nonce, error: "cancelled" });
  await expect(q).rejects.toThrow("cancelled");
});

test("os.window sends self-control messages to the shell; os.db talks to the host and watches over EventSource", async () => {
  const sh = shellOf();
  const r = recorder(200, { id: "a", rev: 1 });
  const es: { url: string; fire(d: string): void; closed: boolean }[] = [];
  const os = createOS({
    location: loc("pwa.localhost"), fetch: r.fetch, ...sh.env,
    eventSource: (url) => {
      const o = { url, closed: false, fn: (_: { data: string }) => {}, fire(d: string) { o.fn({ data: d }); }, addEventListener: (_t: string, f: (e: { data: string }) => void) => void (o.fn = f), close: () => void (o.closed = true) };
      es.push(o);
      return o;
    },
  });
  expect(await os.window.setTitle("Hi")).toBe(true);
  await os.window.moveBy(3, -4);
  await os.window.resize(400, 300);
  await os.window.close();
  expect(sh.sent).toEqual([
    { brasos: "window", op: "title", title: "Hi" }, { brasos: "window", op: "moveBy", dx: 3, dy: -4 },
    { brasos: "window", op: "resize", w: 400, h: 300 }, { brasos: "window", op: "close" },
  ]);
  const notes = os.db.collection("notes");
  await notes.put({ t: 1 }, "a");
  await os.db.collection("chat", { space: "shared" }).list({ where: { room: "x" }, order: { field: "n", dir: "desc" } });
  expect(r.calls.map((c) => [c.url, c.init?.body])).toEqual([
    ["http://localhost:7000/os/db/put", '{"space":"own","col":"notes","doc":{"t":1},"id":"a"}'],
    ["http://localhost:7000/os/db/list", '{"space":"shared","col":"chat","where":{"room":"x"},"order":{"field":"n","dir":"desc"}}'],
  ]);
  const seen: unknown[] = [];
  const off = notes.watch((e) => seen.push(e));
  expect(es[0].url).toBe("http://localhost:7000/os/db/events?space=own&col=notes");
  es[0].fire('{"op":"put","id":"a","rev":2}');
  es[0].fire("not json"); // a bad frame never throws into the app
  expect(seen).toEqual([{ op: "put", id: "a", rev: 2 }]);
  off();
  expect(es[0].closed).toBe(true);
});

test("outside BrasOS the database is an in-memory polyfill with the same change events, and window calls are no-ops", async () => {
  const r = recorder();
  const os = createOS({ location: loc("example.com", ""), fetch: r.fetch });
  const c = os.db.collection("todos");
  const seen: unknown[] = [];
  c.watch((e) => seen.push(e));
  const { id } = await c.put({ t: "a", done: false });
  await c.put({ t: "b", done: true }, "k2");
  expect((await c.list({ where: { done: true } })).map((x) => x.id)).toEqual(["k2"]);
  expect((await c.get(id)).doc.t).toBe("a");
  await c.delete(id);
  expect(seen.map((e: any) => e.op)).toEqual(["put", "put", "delete"]);
  expect(await os.window.close()).toBe(false);
  expect(r.calls.length).toBe(0);
});

test("a refused capability surfaces as an error with the status", async () => {
  const os = createOS({ location: loc("about.localhost"), fetch: recorder(403, { error: "denied" }).fetch });
  await expect(os.web.open("https://example.com")).rejects.toThrow("403");
});

test("apps.open asks the shell through the framing window", async () => {
  const sent: unknown[] = [];
  const os = createOS({ location: loc("about.localhost"), fetch: recorder().fetch, parent: { postMessage: (m, o) => sent.push([m, o]) } });
  expect(await os.apps.open("terminal")).toBe(true);
  expect(sent).toEqual([[{ brasos: "open", id: "terminal" }, "http://localhost:7000"]]);
});

test("outside BrasOS every call degrades to a polyfill and never touches the network", async () => {
  const r = recorder();
  const os = createOS({ location: loc("example.com", ""), fetch: r.fetch, parent: { postMessage: () => {} } });
  expect(os.available).toBe(false);
  expect(await os.info()).toEqual({ os: null, packages: [] });
  expect(await os.apps.list()).toEqual([]);
  expect(await os.apps.open("x")).toBe(false);
  expect(await os.web.open("https://example.com/p")).toEqual({ url: "https://example.com/p", site: "https://example.com" });
  await expect(os.apps.install("https://example.com/m")).rejects.toBeInstanceOf(UnsupportedError);
  expect(r.calls.length).toBe(0);
});

test("with no location at all (a server runtime) it is also outside", () => {
  expect(createOS({ fetch: recorder().fetch }).available).toBe(false);
});
