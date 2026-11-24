import { afterAll, beforeAll, expect, test } from "bun:test";
import { verifyAudit } from "../../audit/src/verify";
import { startHost } from "../src/host";
import { testHost, type TestHost } from "../src/testing";

let h: TestHost;
beforeAll(async () => (h = await testHost()));
afterAll(() => h.stop());

const asApp = (id: string) => ({ headers: { origin: `http://${id}.localhost:${h.port}` } });
const shell = { headers: { "sec-fetch-site": "same-origin" } };

test("the shell and every app are served, each on its own origin", async () => {
  expect((await h.at("localhost")).status).toBe(200);
  for (const id of ["about", "terminal", "crash-test", "browser", "files", "docs"]) expect((await h.at(`${id}.localhost`)).status).toBe(200);
});

test("a restarted window's origin (<id>--<n>) serves the same app", async () => {
  expect((await h.at("about--2.localhost")).status).toBe(200);
});

test("unknown apps are 404 and foreign Host headers are 403", async () => {
  expect((await h.at("nope.localhost")).status).toBe(404);
  expect((await h.at("localhost", "/", { headers: { host: "evil.com" } })).status).toBe(403);
  expect((await h.at("localhost", "/", { headers: { host: "a.b.c.localhost" } })).status).toBe(403);
});

test("the SDK bundle is served on every origin", async () => {
  for (const host of ["localhost", "about.localhost"]) {
    const r = await h.at(host, "/__brasos/sdk.js");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("javascript");
  }
});

test("path traversal never leaves the dist directory", async () => {
  const r = await h.at("localhost", "/..%2f..%2fpackage.json");
  expect([403, 404]).toContain(r.status);
  expect(await r.text()).not.toContain('"workspaces"');
});

test("/os/info is public and lists enabled packages", async () => {
  expect(await (await h.at("localhost", "/os/info", shell)).json()).toEqual({ os: "brasos", packages: [], restart: false, power: false });
});

test("the app list comes from manifests, sorted, with permissions", async () => {
  const apps = await (await h.at("localhost", "/os/apps", shell)).json();
  expect(apps.map((a: any) => a.id)).toEqual(["about", "browser", "crash-test", "docs", "files", "installer", "notes", "packages", "settings", "task-manager", "terminal", "trash"]);
  expect(apps.find((a: any) => a.id === "terminal").permissions).toEqual(["pty", "apps.open"]);
});

test("the capability gate identifies callers by Origin and refuses everyone without the permission", async () => {
  expect((await h.at("localhost", "/os/apps")).status).toBe(403); // no Origin, no Sec-Fetch-Site: unknown caller
  expect((await h.at("localhost", "/os/apps", { headers: { origin: "http://evil.com" } })).status).toBe(403);
  expect((await h.at("localhost", "/os/apps", asApp("about"))).status).toBe(403); // about has no apps.read
  expect((await h.at("localhost", "/os/apps", { headers: { origin: `http://localhost:${h.port}` } })).status).toBe(200); // the shell
  expect((await h.at("localhost", "/os/apps", { headers: { origin: "http://localhost:1" } })).status).toBe(403); // wrong port
});

test("CORS is granted only to our own origins, preflights included", async () => {
  const ok = await h.at("localhost", "/os/info", asApp("about"));
  expect(ok.headers.get("access-control-allow-origin")).toBe(`http://about.localhost:${h.port}`);
  const evil = await h.at("localhost", "/os/info", { headers: { origin: "http://evil.com" } });
  expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  const pre = await h.at("localhost", "/os/web/open", { method: "OPTIONS", ...asApp("browser") });
  expect(pre.status).toBe(204);
  expect(pre.headers.get("access-control-allow-headers")).toBe("content-type");
  expect((await h.at("localhost", "/os/web/open", { method: "OPTIONS", headers: { origin: "http://evil.com" } })).status).toBe(403);
});

test("an unknown package name fails closed instead of silently starting without it", async () => {
  await expect(startHost({ root: ".", packages: ["harden"], dist: ".tmp-nope" })).rejects.toThrow('unknown package "harden"');
});

test("decisions are on the audit trail and the chain verifies", () => {
  const events = h.events();
  const has = (e: string, o: string) => events.some((x) => x.event === e && x.outcome === o);
  expect(has("server.start", "info")).toBe(true);
  expect(has("request.rejected", "deny")).toBe(true);
  expect(has("app.unknown", "deny")).toBe(true);
  expect(has("app.load", "allow")).toBe(true);
  expect(has("capability.apps.read", "deny")).toBe(true);
  expect(verifyAudit(h.lines.join("\n"))).toMatchObject({ ok: true, instances: 1 });
});

test("the in-page devtools are served to website origins only, and never with a package on", async () => {
  const site = `${"a".repeat(32)}.web.localhost`;
  const ok = await h.at(site, "/__brasos/devtools.js");
  expect(ok.status).toBe(200);
  expect((await ok.text()).length).toBeGreaterThan(100_000);
  expect((await h.at("localhost", "/__brasos/devtools.js")).status).toBe(404); // the desktop
  expect((await h.at("terminal.localhost", "/__brasos/devtools.js")).status).toBe(404); // an app
  const hard = await testHost({ packages: ["hardened"] });
  try {
    expect((await hard.at(site, "/__brasos/devtools.js")).status).toBe(404);
  } finally {
    hard.stop();
  }
});
