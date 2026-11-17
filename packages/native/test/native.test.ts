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

/** a stand-in compositor that also answers {"thumb":ID} on the connection that asked */
function thumbCompositor(reply: (id: number) => unknown) {
  const path = join(mkdtempSync(join(tmpdir(), "brasos-comp-")), "t.sock");
  srv = createServer((s) => {
    s.write(JSON.stringify({ windows: [] }) + "\n"); // the list comes first, as on the real socket
    s.on("data", (d) => {
      const m = /"thumb":(\d+)/.exec(String(d));
      if (m) s.write(JSON.stringify(reply(Number(m[1]))) + "\n");
    });
  }).listen(path);
  return path;
}

test("a window's picture comes through for the shell, checked before it is passed on", async () => {
  const rgb = Buffer.alloc(2 * 1 * 3, 7).toString("base64"); // 2 x 1 pixels
  const path = thumbCompositor((id) => (id === 5 ? { thumb: 5, w: 2, h: 1, rgb } : id === 6 ? { thumb: 6, w: 2, h: 1, rgb: "AAAA" } : { thumb: id, error: "not readable" }));
  const h = await testHost({ nativeSocket: path });
  const get = (id: string, from = "localhost") => h.at("localhost", `/os/native/thumb?id=${id}`, { headers: { origin: h.origin(from) } });
  expect(await (await get("5")).json()).toEqual({ w: 2, h: 1, rgb });
  expect((await get("6")).status).toBe(404); // the bytes don't match the size: dropped
  expect((await get("7")).status).toBe(404); // the compositor says it can't
  expect((await get("0")).status).toBe(400);
  expect((await get("abc")).status).toBe(400);
  expect((await get("5", "about.localhost")).status).toBe(403); // apps hold no native.read
  expect((await h.at("localhost", "/os/native/thumb?id=5")).status).toBe(403); // no identifiable caller
  h.stop();
  const hard = await testHost({ packages: ["hardened"], nativeSocket: path });
  expect((await hard.at("localhost", "/os/native/thumb?id=5", { headers: { origin: hard.origin("localhost") } })).status).toBe(403);
  hard.stop();
});

test("without a compositor there is no picture", async () => {
  const h = await testHost();
  expect((await h.at("localhost", "/os/native/thumb?id=5", { headers: { origin: h.origin("localhost") } })).status).toBe(404);
  h.stop();
});

test("a web app that runs in the real browser is started by id with its address, and never offered in Start", async () => {
  const c = fakeCompositor([]);
  const list = join(mkdtempSync(join(tmpdir(), "brasos-apps-")), "apps.json");
  await Bun.write(list, JSON.stringify([{ id: "web", name: "Browser", icon: "browser", takesUrl: true }, { id: "webapp", name: "Web app", icon: "globe", takesUrl: true, listed: false }, { id: "foot", name: "Terminal" }]));
  const h = await testHost({ nativeSocket: c.path, nativeApps: list });
  const as = (from: string) => ({ origin: h.origin(from) });
  expect((await (await h.at("localhost", "/os/native/apps", { headers: as("localhost") })).json()).apps.map((a: any) => a.id)).toEqual(["web", "foot"]); // webapp is not listed
  const launch = (id: string, url: unknown, from = "localhost") => h.at("localhost", "/os/native/launch", { method: "POST", headers: as(from), body: JSON.stringify({ id, url }) });
  expect((await launch("webapp", "https://notes.example.com/app/")).status).toBe(202);
  expect((await launch("webapp", "javascript:alert(1)")).status).toBe(400);
  expect((await launch("webapp", "https://a b")).status).toBe(400);
  expect((await launch("foot", "https://notes.example.com/")).status).toBe(400); // an app that takes no address
  expect((await launch("webapp", "https://notes.example.com/", "about.localhost")).status).toBe(403);
  await Bun.sleep(100);
  expect(c.got).toEqual(['{"open":"webapp","url":"https://notes.example.com/app/"}']);
  h.stop();
});
