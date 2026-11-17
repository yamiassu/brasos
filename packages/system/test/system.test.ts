import { expect, test } from "bun:test";
import { testHost } from "../../host/src/testing";

const post = (h: Awaited<ReturnType<typeof testHost>>, from: string) =>
  h.at("localhost", "/os/system/restart", { method: "POST", headers: { origin: h.origin(from) } });

test("restart: allowed for the shell, audited, runs the supervisor command after answering", async () => {
  let calls = 0;
  const h = await testHost({ restart: () => void calls++ });
  expect((await (await h.at("localhost", "/os/info")).json()).restart).toBe(true);
  const r = await post(h, "localhost");
  expect(r.status).toBe(202);
  expect(calls).toBe(0);
  await Bun.sleep(400);
  expect(calls).toBe(1);
  expect(h.events().some((e) => e.event === "system.restart" && e.actor.app === "shell")).toBe(true);
  h.stop();
});

test("restart: an app without the permission is refused and nothing restarts", async () => {
  let calls = 0;
  const h = await testHost({ restart: () => void calls++ });
  expect((await post(h, "about.localhost")).status).toBe(403);
  expect((await h.at("localhost", "/os/system/restart", { method: "POST" })).status).toBe(403); // no identifiable caller
  await Bun.sleep(400);
  expect(calls).toBe(0);
  h.stop();
});

test("restart: without a supervisor it says so; the hardened package denies it", async () => {
  const h = await testHost();
  expect((await post(h, "localhost")).status).toBe(501);
  expect((await (await h.at("localhost", "/os/info")).json()).restart).toBe(false);
  h.stop();
  const hard = await testHost({ packages: ["hardened"], restart: () => {} });
  expect((await post(hard, "localhost")).status).toBe(403);
  hard.stop();
});

import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkNewApp, scaffoldApp } from "../src/system";

test("new app: ids and names are validated before anything is written", () => {
  const none = () => false;
  for (const id of ["", "a", "A", "1x", "a--b", "-a", "a-", "a_b", "../x", "x".repeat(31), "a b"]) {
    expect(checkNewApp({ id, name: "N" }, none).ok).toBe(false);
  }
  expect(checkNewApp({ id: "notes", name: "" }, none).ok).toBe(false);
  expect(checkNewApp({ id: "notes", name: "x".repeat(61) }, none).ok).toBe(false);
  expect(checkNewApp({ id: "notes", name: "Notes" }, () => true)).toMatchObject({ ok: false, status: 409 });
  expect(checkNewApp(null, none).ok).toBe(false);
  const ok = checkNewApp({ id: "my-notes", name: " Notes ", icon: "../evil" }, none);
  expect(ok).toEqual({ ok: true, app: { id: "my-notes", name: "Notes", icon: "app" } });
});

test("new app: scaffold writes a manifest, page and script, escaping the name", () => {
  const dir = mkdtempSync(join(tmpdir(), "brasos-apps-"));
  scaffoldApp(dir, { id: "demo", name: '<b>"Demo"</b>', icon: "app" });
  expect(JSON.parse(readFileSync(join(dir, "demo/manifest.webmanifest"), "utf8")).name).toBe('<b>"Demo"</b>');
  const html = readFileSync(join(dir, "demo/index.html"), "utf8");
  expect(html).not.toContain("<b>");
  expect(html).toContain("&lt;b&gt;");
  expect(existsSync(join(dir, "demo/main.ts"))).toBe(true);
  rmSync(dir, { recursive: true, force: true });
});

const act = (h: Awaited<ReturnType<typeof testHost>>, from: string, path: string, body?: unknown) =>
  h.at("localhost", path, { method: "POST", headers: { origin: h.origin(from), "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });

test("rebuild and create: the shell may; an app, an anonymous caller, hardened and a system without a supervisor may not", async () => {
  const h = await testHost({ restart: () => {} });
  expect((await act(h, "localhost", "/os/system/app", { id: "a", name: "N" })).status).toBe(400); // validated, nothing written
  expect((await act(h, "localhost", "/os/system/app", { id: "about", name: "N" })).status).toBe(409); // never overwrites
  expect((await act(h, "about.localhost", "/os/system/app", { id: "zzz-new", name: "N" })).status).toBe(403);
  expect((await act(h, "about.localhost", "/os/system/rebuild")).status).toBe(403);
  expect((await h.at("localhost", "/os/system/rebuild", { method: "POST" })).status).toBe(403);
  expect(existsSync(join(import.meta.dir, "../../../apps/zzz-new"))).toBe(false);
  h.stop();
  const none = await testHost();
  expect((await act(none, "localhost", "/os/system/rebuild")).status).toBe(501);
  none.stop();
  const hard = await testHost({ packages: ["hardened"], restart: () => {} });
  expect((await act(hard, "localhost", "/os/system/app", { id: "zzz-new", name: "N" })).status).toBe(403);
  expect((await act(hard, "localhost", "/os/system/rebuild")).status).toBe(403);
  hard.stop();
});

const power = (h: Awaited<ReturnType<typeof testHost>>, from: string | null, body: unknown) =>
  h.at("localhost", "/os/system/power", { method: "POST", body: JSON.stringify(body), headers: from ? { origin: h.origin(from) } : {} });

test("power: the shell can shut down or reboot, only those two actions, audited, after answering", async () => {
  const got: string[] = [];
  const h = await testHost({ power: (a) => void got.push(a) });
  expect((await (await h.at("localhost", "/os/info")).json()).power).toBe(true);
  for (const action of ["halt", "poweroff; id", "", 7, undefined]) expect((await power(h, "localhost", { action })).status).toBe(400);
  expect((await power(h, "localhost", { action: "poweroff" })).status).toBe(202);
  expect(got).toEqual([]);
  await Bun.sleep(450);
  expect(got).toEqual(["poweroff"]);
  expect((await power(h, "localhost", { action: "reboot" })).status).toBe(202);
  await Bun.sleep(450);
  expect(got).toEqual(["poweroff", "reboot"]);
  expect(h.events().some((e) => e.event === "system.power" && e.detail.action === "reboot" && e.actor.app === "shell")).toBe(true);
  h.stop();
});

test("power: an app, a request with no caller and the hardened package are refused, and nothing happens", async () => {
  const got: string[] = [];
  const h = await testHost({ power: (a) => void got.push(a) });
  expect((await power(h, "terminal", { action: "poweroff" })).status).toBe(403); // an app does not hold it
  expect((await power(h, null, { action: "poweroff" })).status).toBe(403);
  const hard = await testHost({ power: (a) => void got.push(a), packages: ["hardened"] });
  expect((await (await hard.at("localhost", "/os/info")).json()).power).toBe(false);
  expect((await power(hard, "localhost", { action: "poweroff" })).status).toBe(403);
  await Bun.sleep(450);
  expect(got).toEqual([]);
  expect(h.events().some((e) => e.event === "capability.system.power" && e.outcome === "deny")).toBe(true);
  h.stop();
  hard.stop();
});

test("power: a system without a power command says so", async () => {
  const h = await testHost();
  expect((await power(h, "localhost", { action: "poweroff" })).status).toBe(501);
  h.stop();
});
