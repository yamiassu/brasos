import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRegistry } from "../src/registry";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = () => (dirs.push(mkdtempSync(join(tmpdir(), "brasos-reg-"))), dirs.at(-1)!);

function fixture() {
  const appsDir = tmp();
  const add = (id: string, m: object) => (mkdirSync(join(appsDir, id)), writeFileSync(join(appsDir, id, "manifest.webmanifest"), JSON.stringify(m)));
  add("zeta", { name: "Zeta", brasos: { icon: "Z", permissions: ["pty"] } });
  add("alpha", { name: "Alpha", brasos: { hardened: true } });
  mkdirSync(join(appsDir, "no-manifest")); // a directory without a manifest is not an app
  return appsDir;
}

test("builtin apps come from manifests, sorted, with defaults", () => {
  const r = createRegistry({ appsDir: fixture() });
  expect(r.list().map((a) => [a.id, a.name, a.icon, a.permissions])).toEqual([
    ["alpha", "Alpha", "app", []],
    ["zeta", "Zeta", "Z", ["pty"]],
  ]);
  expect(r.has("zeta")).toBe(true);
  expect(r.has("no-manifest")).toBe(false);
});

test("a policy filters apps out of the list and out of lookups", () => {
  const r = createRegistry({ appsDir: fixture(), allowApp: (m) => m.brasos?.hardened === true });
  expect(r.list().map((a) => a.id)).toEqual(["alpha"]);
  expect(r.has("zeta")).toBe(false);
});

const manifestAt = (m: object) => async () => m;

test("installing a PWA stores it with no permissions, whatever the manifest claims", async () => {
  const state = tmp();
  const r = createRegistry({
    appsDir: fixture(), stateDir: state,
    fetchManifest: manifestAt({ name: "Notes", start_url: "/app/", brasos: { permissions: ["pty"] }, permissions: ["pty"] }),
  });
  const app = await r.install("https://notes.example.com/manifest.webmanifest");
  expect(app).toMatchObject({ kind: "pwa", name: "Notes", start_url: "https://notes.example.com/app/", permissions: [] });
  expect(r.get(app.id)).toEqual(app);
  expect(readdirSync(join(state, "apps"))).toEqual([app.id + ".json"]);
});

test("reinstalling the same app updates it instead of duplicating it", async () => {
  const r = createRegistry({ appsDir: fixture(), stateDir: tmp(), fetchManifest: manifestAt({ name: "Notes" }) });
  const a = await r.install("https://notes.example.com/m.json");
  const b = await r.install("https://notes.example.com/m.json");
  expect(a.id).toBe(b.id);
  expect(r.list().filter((x) => x.kind === "pwa").length).toBe(1);
});

test("bad manifests are rejected", async () => {
  const bad = (m: object | null) => createRegistry({ appsDir: fixture(), stateDir: tmp(), fetchManifest: manifestAt(m as object) }).install("https://x.example.com/m");
  await expect(bad({})).rejects.toThrow("no name");
  await expect(bad(null)).rejects.toThrow("no name");
  await expect(bad({ name: "X", start_url: "https://evil.example.org/" })).rejects.toThrow("manifest's origin");
});

test("installing is unavailable without a state dir or a fetcher", async () => {
  await expect(createRegistry({ appsDir: fixture(), fetchManifest: manifestAt({ name: "X" }) }).install("https://x.example.com/m")).rejects.toThrow("not available");
  await expect(createRegistry({ appsDir: fixture(), stateDir: tmp() }).install("https://x.example.com/m")).rejects.toThrow("not available");
});

test("a policy that needs an opt-in hides installed PWAs, and uninstall only touches PWAs", async () => {
  const state = tmp();
  const open = createRegistry({ appsDir: fixture(), stateDir: state, fetchManifest: manifestAt({ name: "Notes" }) });
  const app = await open.install("https://notes.example.com/m");
  expect(createRegistry({ appsDir: fixture(), stateDir: state, allowApp: (m) => m.brasos?.hardened === true }).list().some((a) => a.kind === "pwa")).toBe(false);
  expect(() => open.uninstall("alpha")).toThrow();
  expect(() => open.uninstall("pwa-../../etc")).toThrow();
  open.uninstall(app.id);
  expect(existsSync(join(state, "apps", app.id + ".json"))).toBe(false);
});
