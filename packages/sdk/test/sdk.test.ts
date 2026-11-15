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

test("web.open and apps.install POST JSON", async () => {
  const r = recorder(200, { url: "x", site: "y" });
  const os = createOS({ location: loc("browser.localhost"), fetch: r.fetch });
  await os.web.open("https://example.com/a");
  await os.apps.install("https://example.com/m.webmanifest");
  expect(r.calls.map((c) => [c.url, c.init?.method, c.init?.body])).toEqual([
    ["http://localhost:7000/os/web/open", "POST", '{"url":"https://example.com/a"}'],
    ["http://localhost:7000/os/apps/install", "POST", '{"manifestUrl":"https://example.com/m.webmanifest"}'],
  ]);
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
