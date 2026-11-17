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
  const c = fakeCompositor([{ id: 3999999999, title: "foot", app: "foot", focused: true, w: 800, h: 600.7, secret: "x" }]);
  const h = await testHost({ nativeSocket: c.path });
  const r = await (await h.at("localhost", "/os/native", { headers: asShell(h) })).json();
  expect(r).toEqual({ available: true, windows: [{ id: 3999999999, title: "foot", app: "foot", focused: true, w: 800, h: 600, ssd: true, x: 0, y: 0 }] });
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
  expect(await (await get("/os/native/apps")).json()).toEqual({ apps: [{ id: "foot", name: "Terminal", icon: "terminal", takesUrl: false }] }); // no command leaks, bad ids dropped
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

test("the shell's own page can read (a same-origin GET carries Sec-Fetch-Site, not Origin)", async () => {
  const c = fakeCompositor([{ id: 2, title: "t", app: "a", focused: false }]);
  const h = await testHost({ nativeSocket: c.path });
  const r = await h.at("localhost", "/os/native", { headers: { "sec-fetch-site": "same-origin" } });
  expect((await r.json()).windows.length).toBe(1);
  expect((await h.at("localhost", "/os/native", { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
  h.stop();
});

test("place: the shell positions a window's content; bad numbers are refused; an app may not", async () => {
  const c = fakeCompositor([]);
  const h = await testHost({ nativeSocket: c.path });
  const place = (body: unknown, headers: Record<string, string> = asShell(h)) => h.at("localhost", "/os/native/place", { method: "POST", headers, body: JSON.stringify(body) });
  expect((await place({ id: 5, x: 10, y: -20, w: 800, h: 600 })).status).toBe(200);
  for (const bad of [{ id: 5, x: 1.5, y: 0, w: 800, h: 600 }, { id: 5, x: 0, y: 0, w: 10, h: 600 }, { id: 0, x: 0, y: 0, w: 800, h: 600 }, { id: 5, x: "1", y: 0, w: 800, h: 600 }, { id: 5, x: 99999, y: 0, w: 800, h: 600 }, null]) {
    expect((await place(bad)).status).toBe(400);
  }
  expect((await place({ id: 5, x: 0, y: 0, w: 800, h: 600 }, { origin: h.origin("about.localhost") })).status).toBe(403);
  await Bun.sleep(100);
  expect(c.got).toEqual(['{"place":[5,10,-20,800,600]}']);
  h.stop();
  const hard = await testHost({ packages: ["hardened"], nativeSocket: c.path });
  expect((await hard.at("localhost", "/os/native/place", { method: "POST", headers: asShell(hard), body: '{"id":5,"x":0,"y":0,"w":800,"h":600}' })).status).toBe(403);
  hard.stop();
});

test("an address goes only to an app that takes one, only as plain http(s), and only the site is audited", async () => {
  const c = fakeCompositor([]);
  const apps = join(mkdtempSync(join(tmpdir(), "brasos-apps-")), "apps.json");
  await Bun.write(apps, JSON.stringify([{ id: "web", name: "Browser", icon: "browser", takesUrl: true }, { id: "foot", name: "Terminal", icon: "terminal" }]));
  const h = await testHost({ nativeSocket: c.path, nativeApps: apps });
  const launch = (body: unknown, from = "localhost") => h.at("localhost", "/os/native/launch", { method: "POST", headers: { origin: h.origin(from) }, body: JSON.stringify(body) });
  expect((await launch({ id: "web", url: "https://accounts.example.com/signin?x=1&y=2#z" })).status).toBe(202);
  expect((await launch({ id: "web" })).status).toBe(202);
  for (const url of ["file:///etc/passwd", "javascript:alert(1)", "--remote-debugging-port=9222", "https://a b", 'https://a"b', "https://a\b", "ftp://x", "https://" + "a".repeat(2100), 42])
    expect([String(url).slice(0, 30), (await launch({ id: "web", url })).status]).toEqual([String(url).slice(0, 30), 400]);
  expect((await launch({ id: "foot", url: "https://example.com" })).status).toBe(400); // that app takes no address
  expect((await launch({ id: "web", url: "https://example.com" }, "browser.localhost")).status).toBe(403); // an app may not launch anything itself
  await Bun.sleep(100);
  expect(c.got).toEqual(['{"open":"web","url":"https://accounts.example.com/signin?x=1&y=2#z"}', '{"launch":"web"}']);
  const ev = h.events().filter((e) => e.event === "native.launch");
  expect(JSON.stringify(ev)).toContain("accounts.example.com");
  expect(JSON.stringify(ev)).not.toContain("signin");
  expect(JSON.stringify(ev)).not.toContain("x=1");
  h.stop();
});

test("installed Flatpak apps are listed and started by application id only, from the user's own list", async () => {
  const dir = mkdtempSync(join(tmpdir(), "brasos-fp-"));
  const js = join(dir, "flatpak.js").split("\\").join("/");
  await Bun.write(js, `if (process.argv[2] === "list") console.log(["com.valvesoftware.Steam", "Steam", "1.0"].join(String.fromCharCode(9)));`);
  const saved = process.env.BRASOS_FLATPAK;
  process.env.BRASOS_FLATPAK = `${process.execPath} ${js}`;
  try {
    const c = fakeCompositor([]);
    const h = await testHost({ nativeSocket: c.path });
    const asShellOrigin = { origin: h.origin("localhost") };
    expect((await (await h.at("localhost", "/os/native/apps", { headers: asShellOrigin })).json()).apps).toEqual([{ id: "flatpak:com.valvesoftware.Steam", name: "Steam", icon: "app", takesUrl: false }]);
    const launch = (id: string, headers: Record<string, string> = asShellOrigin) => h.at("localhost", "/os/native/launch", { method: "POST", headers, body: JSON.stringify({ id }) });
    expect((await launch("flatpak:com.valvesoftware.Steam")).status).toBe(202);
    for (const bad of ["flatpak:com.other.App", "flatpak:--help", "flatpak:com.x.Y z", "flatpak:"]) expect((await launch(bad)).status).toBe(404); // not installed, or not an id
    expect((await launch("flatpak:com.valvesoftware.Steam", { origin: h.origin("about.localhost") })).status).toBe(403);
    await Bun.sleep(100);
    expect(c.got).toEqual(['{"run":"flatpak","app":"com.valvesoftware.Steam"}']);
    h.stop();
  } finally {
    if (saved === undefined) delete process.env.BRASOS_FLATPAK;
    else process.env.BRASOS_FLATPAK = saved;
  }
});
