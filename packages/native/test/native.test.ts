import { afterEach, expect, test } from "bun:test";
import { createServer, type Server } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testHost } from "../../host/src/testing";

let srv: Server | undefined;
afterEach(() => srv?.close());

/** a stand-in compositor: sends one window list per connection and records commands */
function fakeCompositor(windows: unknown[]) {
  const path = join(mkdtempSync(join(tmpdir(), "brasos-comp-")), "c.sock");
  const got: string[] = [];
  srv = createServer((s) => {
    s.write(JSON.stringify({ windows }) + "\n");
    s.on("data", (d) => got.push(String(d).trim()));
  }).listen(path);
  return { path, got };
}
const asShell = (h: { origin(host: string): string }) => ({ origin: h.origin("localhost") });

test("lists native windows for the shell, keeping only known fields", async () => {
  const c = fakeCompositor([{ id: 3, title: "foot", app: "foot", focused: true, secret: "x" }]);
  const h = await testHost({ nativeSocket: c.path });
  const r = await (await h.at("localhost", "/os/native", { headers: asShell(h) })).json();
  expect(r).toEqual({ available: true, windows: [{ id: 3, title: "foot", app: "foot", focused: true }] });
  h.stop();
});

test("focus and close reach the compositor, are validated and audited", async () => {
  const c = fakeCompositor([]);
  const h = await testHost({ nativeSocket: c.path });
  const post = (op: string, body: unknown) => h.at("localhost", `/os/native/${op}`, { method: "POST", headers: asShell(h), body: JSON.stringify(body) });
  expect((await post("focus", { id: 7 })).status).toBe(200);
  expect((await post("close", { id: 8 })).status).toBe(200);
  expect((await post("focus", { id: "7; rm" })).status).toBe(400);
  expect((await post("focus", { id: -1 })).status).toBe(400);
  await Bun.sleep(100);
  expect(c.got).toEqual(['{"focus":7}', '{"close":8}']);
  expect(h.events().filter((e) => e.event === "native.focus" || e.event === "native.close").length).toBe(2);
  h.stop();
});

test("an app, an unknown caller and the hardened package are refused; no socket means no windows", async () => {
  const c = fakeCompositor([{ id: 1 }]);
  const h = await testHost({ nativeSocket: c.path });
  const app = { origin: h.origin("about.localhost") };
  expect((await h.at("localhost", "/os/native", { headers: app })).status).toBe(403);
  expect((await h.at("localhost", "/os/native/close", { method: "POST", headers: app, body: '{"id":1}' })).status).toBe(403);
  expect((await h.at("localhost", "/os/native/close", { method: "POST", body: '{"id":1}' })).status).toBe(403);
  await Bun.sleep(50);
  expect(c.got).toEqual([]);
  h.stop();
  const hard = await testHost({ packages: ["hardened"], nativeSocket: c.path });
  expect((await hard.at("localhost", "/os/native", { headers: asShell(hard) })).status).toBe(403);
  hard.stop();
  const none = await testHost();
  expect(await (await none.at("localhost", "/os/native", { headers: asShell(none) })).json()).toEqual({ available: false, windows: [] });
  none.stop();
});

test("native apps launch by id only, from the image's list", async () => {
  const c = fakeCompositor([]);
  const list = join(mkdtempSync(join(tmpdir(), "brasos-apps-")), "apps.json");
  await Bun.write(list, JSON.stringify([{ id: "foot", name: "Terminal", icon: "terminal", command: ["/bin/sh", "-c", "evil"] }, { id: "BAD ID", name: "x" }]));
  const h = await testHost({ nativeSocket: c.path, nativeApps: list });
  const get = (path: string, from = "localhost") => h.at("localhost", path, { headers: { origin: h.origin(from) } });
  expect(await (await get("/os/native/apps")).json()).toEqual({ apps: [{ id: "foot", name: "Terminal", icon: "terminal" }] }); // no command leaks, bad ids dropped
  const launch = (id: unknown, from = "localhost") => h.at("localhost", "/os/native/launch", { method: "POST", headers: { origin: h.origin(from) }, body: JSON.stringify({ id }) });
  expect((await launch("foot")).status).toBe(202);
  expect((await launch("sh")).status).toBe(404);
  expect((await launch('foot"}{"close":1')).status).toBe(404);
  expect((await launch("foot", "about.localhost")).status).toBe(403);
  await Bun.sleep(100);
  expect(c.got).toEqual(['{"launch":"foot"}']);
  expect(h.events().filter((e) => e.event === "native.launch").length).toBe(1);
  h.stop();
  const hard = await testHost({ packages: ["hardened"], nativeSocket: c.path, nativeApps: list });
  expect((await hard.at("localhost", "/os/native/launch", { method: "POST", headers: { origin: hard.origin("localhost") }, body: '{"id":"foot"}' })).status).toBe(403);
  hard.stop();
});
