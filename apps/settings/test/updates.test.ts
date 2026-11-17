import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testHost, type TestHost } from "../../../packages/host/src/testing";
import { feed, interfaceBuild, parseManifest } from "../updates";

const tmp = mkdtempSync(join(tmpdir(), "brasos-upd-"));
// a fake updater is a Bun script (the command is split on spaces: no spaces in these paths); it writes its argv to a file
const script = (name: string, body: string) => (writeFileSync(join(tmp, name), body), `${process.execPath} ${join(tmp, name)}`);
const argvFile = join(tmp, "argv.txt").replaceAll("\\", "/");

test("the manifest is accepted only in its exact shape", () => {
  const ok = { version: "2026.11.16-a1", flake: "https://example.com/brasos.tar.gz?narHash=sha256-abc%3D", notes: "x" };
  expect(parseManifest(JSON.stringify(ok))).toEqual(ok);
  expect(parseManifest("nope")).toBeNull();
  expect(parseManifest(JSON.stringify({ ...ok, flake: "http://example.com/x" }))).toBeNull(); // https only
  expect(parseManifest(JSON.stringify({ ...ok, flake: "https://example.com/x; reboot" }))).toBeNull();
  expect(parseManifest(JSON.stringify({ ...ok, flake: "file:///etc/passwd" }))).toBeNull();
  expect(parseManifest(JSON.stringify({ ...ok, version: "a b" }))).toBeNull();
  expect(parseManifest(JSON.stringify({ flake: ok.flake }))).toBeNull();
});

test("the interface build: current, older, unstamped, or unknown where the image says nothing", () => {
  const live = mkdtempSync(join(tmpdir(), "brasos-live-"));
  const src = (h: string) => `/nix/store/${h.repeat(32).slice(0, 32)}-brasos-src`;
  const env = { BRASOS_SRC: src("a"), BRASOS_LIVE: live };
  expect(interfaceBuild({})).toBeNull();
  expect(interfaceBuild({ BRASOS_SRC: "/tmp/x", BRASOS_LIVE: live })).toBeNull(); // not a store path
  expect(interfaceBuild(env)).toEqual({ system: "aaaaaaaa", from: "", state: "unstamped" });
  writeFileSync(join(live, ".brasos-seed"), `treehash
${src("a")}
`);
  expect(interfaceBuild(env)).toEqual({ system: "aaaaaaaa", from: "aaaaaaaa", state: "current" });
  writeFileSync(join(live, ".brasos-seed"), `treehash
${src("b")}
`);
  expect(interfaceBuild(env)).toEqual({ system: "aaaaaaaa", from: "bbbbbbbb", state: "older" });
});

let h: TestHost;
let hardened: TestHost;
let server: ReturnType<typeof Bun.serve>;
beforeAll(async () => {
  server = Bun.serve({ port: 0, fetch: () => Response.json({ version: "NEW", flake: "https://example.com/new.tar.gz", notes: "fixes" }) });
  process.env.BRASOS_UPDATE_URL = `http://localhost:${server.port}/manifest.json`;
  process.env.BRASOS_VERSION = "OLD";
  process.env.BRASOS_UPDATE_CMD = "";
  h = await testHost();
  hardened = await testHost({ packages: ["hardened"] });
});
afterAll(() => (h.stop(), hardened.stop(), server.stop(true)));
const own = (host: TestHost, id: string) => `http://${id}.localhost:${host.port}`;
const call = (host: TestHost, as: string, path: string, init: RequestInit = {}) =>
  fetch(`${own(host, "settings")}${path}`, { ...init, headers: { origin: own(host, as), "content-type": "application/json" } });
const post = (as: string, body: unknown, host = h) => call(host, as, "/updates/run", { method: "POST", body: JSON.stringify(body) });

test("status compares this build with the manifest; others, foreign pages and the hardened package are refused", async () => {
  const d = await (await call(h, "settings", "/updates")).json();
  expect(d).toMatchObject({ enabled: false, current: "OLD", available: true, latest: { version: "NEW", notes: "fixes" } });
  expect((await call(h, "about", "/updates")).status).toBe(403);
  expect((await fetch(`${own(h, "settings")}/updates`, { headers: { origin: "http://evil.com" } })).status).toBe(403);
  expect((await fetch(`${own(h, "settings")}/updates`, { headers: { "sec-fetch-site": "same-origin" } })).status).toBe(200);
  expect((await fetch(`${own(h, "settings")}/updates`, { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
  expect((await call(hardened, "settings", "/updates")).status).not.toBe(200);
  expect((await post("settings", { action: "apply" }, hardened)).status).toBeGreaterThanOrEqual(400);
});

test("nothing runs without an updater, and only the known actions run", async () => {
  expect((await post("settings", { action: "apply" })).status).toBe(501);
  process.env.BRASOS_UPDATE_CMD = script("fake-update.js", `await Bun.write(${JSON.stringify(argvFile)}, process.argv.slice(2).join(" ")); console.log("SECRET-OUTPUT"); await Bun.sleep(400);`);
  for (const action of ["", "format", "__proto__", "--local", 7]) expect((await post("settings", { action })).status).toBe(400);
  expect((await post("about", { action: "apply" })).status).toBe(403);
  expect((await post("settings", { action: "rollback" })).status).toBe(202);
  expect((await post("settings", { action: "apply" })).status).toBe(409); // one at a time
  let s = await (await call(h, "settings", "/updates")).json();
  for (let i = 0; i < 80 && s.job.state === "running"; i++) (await Bun.sleep(100), (s = await (await call(h, "settings", "/updates")).json())); // wait for the job, however busy the machine is
  expect(s.job).toMatchObject({ state: "done", action: "rollback" });
  expect(s.job.log).toContain("SECRET-OUTPUT");
  expect(await Bun.file(argvFile).text()).toBe("--rollback"); // the host passes a fixed flag, never anything from the request or the manifest
});

test("the decisions and the job are audited, the output is not", async () => {
  const e = h.events();
  expect(e.some((x) => x.event === "capability.system.update" && x.outcome === "allow" && x.actor.app === "settings")).toBe(true);
  expect(e.some((x) => x.event === "capability.system.update" && x.outcome === "deny")).toBe(true);
  expect(e.some((x) => x.event === "system.update.start" && x.detail.action === "rollback")).toBe(true);
  expect(e.some((x) => x.event === "system.update.finish" && x.detail.exit === 0)).toBe(true);
  expect(JSON.stringify(e)).not.toContain("SECRET-OUTPUT");
});

test("the updater's output becomes a step, a count and a name", () => {
  const p = { step: "", detail: "", fetched: 0, fetchTotal: 0, built: 0, buildTotal: 0, started: 0, last: 0 };
  for (const l of ["these 2 derivations will be built:", "these 3 paths will be fetched (10.0 MiB download, 40.0 MiB unpacked):", "copying path '/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-glibc-2.40' from 'https://cache.nixos.org'...", "building '/nix/store/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-brasos-shell.drv'..."]) feed(p, l);
  expect(p).toMatchObject({ step: "Building", detail: "brasos-shell", fetched: 1, fetchTotal: 3, built: 1, buildTotal: 2 });
  feed(p, "activating the configuration...");
  expect(p.step).toBe("Switching to the new system");
  feed(p, "removing generation 4");
  expect(p.step).toBe("Cleaning up old versions");
});
