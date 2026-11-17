import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testHost, type TestHost } from "../../../packages/host/src/testing";
import { buildPackages, parsePathInfo, splitName } from "../server";

const h32 = (c: string) => c.repeat(32);
const P = (c: string, rest: string) => `/nix/store/${h32(c)}-${rest}`;
const glibc = P("a", "glibc-2.40"), ssl = P("b", "openssl-3.3.2"), git = P("c", "git-2.47.0"), gitMan = P("d", "git-2.47.0-man"), sw = P("e", "system-path");
const graph = {
  [glibc]: { narSize: 32e6, references: [glibc] },
  [ssl]: { narSize: 14e6, references: [glibc, ssl] },
  [git]: { narSize: 48e6, references: [ssl, glibc, git] },
  [gitMan]: { narSize: 2e6, references: [] },
  [sw]: { narSize: 1000, references: [git, ssl, glibc, gitMan] },
};

test("store paths split into name, version and output", () => {
  expect(splitName(git)).toEqual({ name: "git", version: "2.47.0", output: "" });
  expect(splitName(P("f", "xgcc-16.2.0-libgcc"))).toEqual({ name: "xgcc", version: "16.2.0", output: "libgcc" });
  expect(splitName(P("f", "source"))).toEqual({ name: "source", version: "", output: "" });
  expect(splitName("/tmp/x")).toBeNull();
});

test("both `nix path-info --json` shapes parse; junk gives nothing", () => {
  expect(parsePathInfo(JSON.stringify(graph)).get(git)?.references.length).toBe(3);
  const old = JSON.stringify([{ path: git, narSize: 5, references: [ssl] }]);
  expect(parsePathInfo(old).get(git)).toEqual({ narSize: 5, references: [ssl] });
  expect(parsePathInfo("nope").size).toBe(0);
});

test("packages come with sizes, kinds and the dependencies the store records; man pages are skipped", () => {
  const pkgs = buildPackages(parsePathInfo(JSON.stringify(graph)), graph[sw].references);
  expect(pkgs.map((p) => p.id)).toEqual(["git", "glibc", "openssl"]);
  const by = Object.fromEntries(pkgs.map((p) => [p.id, p]));
  expect(by.git).toMatchObject({ version: "2.47.0", size: 48, kind: "Tool", deps: ["glibc", "openssl"] });
  expect(by.openssl).toMatchObject({ kind: "Library", deps: ["glibc"] });
  expect(by.glibc.deps).toEqual([]);
});

let h: TestHost;
let hardened: TestHost;
beforeAll(async () => {
  // a fake `nix` (a Bun script: the command is split on spaces, so no spaces in the path) that answers path-info
  const dir = mkdtempSync(join(tmpdir(), "brasos-nix-"));
  writeFileSync(join(dir, "nix.js"), `console.log(${JSON.stringify(JSON.stringify(graph))});`);
  process.env.BRASOS_NIX = `${process.execPath} ${join(dir, "nix.js").split("\\").join("/")}`;
  process.env.BRASOS_NIX_ROOT = sw;
  h = await testHost();
  hardened = await testHost({ packages: ["hardened"] });
});
afterAll(() => (h.stop(), hardened.stop()));
const own = (host: TestHost, id: string) => `http://${id}.localhost:${host.port}`;
const call = (host: TestHost, as: string, path: string) => fetch(`${own(host, "packages")}${path}`, { headers: { origin: own(host, as) } });

test("the Packages app reads the system's packages and cannot change them; others are refused", async () => {
  const r = await call(h, "packages", "/packages");
  expect(r.status).toBe(200);
  const d = await r.json();
  expect(d.canChange).toBe(false);
  expect(d.packages.map((p: any) => p.id)).toEqual(["git", "glibc", "openssl"]);
  expect((await call(h, "about", "/packages")).status).toBe(403);
  expect((await fetch(`${own(h, "packages")}/packages`, { headers: { origin: "http://evil.com" } })).status).toBe(403);
  expect((await fetch(`${own(h, "packages")}/packages`, { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
});

test("the hardened package has no Packages app", async () => {
  const apps = await hardened.at("localhost", "/os/apps", { headers: { origin: hardened.origin("localhost") } });
  expect((await apps.json()).map((a: any) => a.id)).not.toContain("packages");
  expect((await call(hardened, "packages", "/packages")).status).not.toBe(200);
});
