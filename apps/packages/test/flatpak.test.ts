import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testHost, type TestHost } from "../../../packages/host/src/testing";
import { parseSearch, percentOf, safeQuery } from "../flatpak";

const STEAM = "com.valvesoftware.Steam";
let h: TestHost;
let hardened: TestHost;
let saved: string | undefined;

beforeAll(async () => {
  // a fake `flatpak` (a Bun script) that keeps the installed list in a file and answers list, search, install and uninstall
  const dir = mkdtempSync(join(tmpdir(), "brasos-flatpak-"));
  const state = join(dir, "installed.txt").split("\\").join("/");
  writeFileSync(
    join(dir, "flatpak.js"),
    `import { existsSync, readFileSync, writeFileSync } from "node:fs";
const f = ${JSON.stringify(state)};
const [cmd, ...rest] = process.argv.slice(2);
const read = () => (existsSync(f) ? readFileSync(f, "utf8").split("\\n").filter(Boolean) : []);
if (cmd === "list") for (const id of read()) console.log(id + "\\tApp " + id.split(".").pop() + "\\t1.0");
else if (cmd === "search") console.log("${STEAM}\\tSteam\\tThe ultimate game platform\\nnot an id\\tx\\ty");
else if (cmd === "install") { console.log("Installing... 50%"); writeFileSync(f, [...read(), rest[rest.length - 1]].join("\\n")); console.log("Installing... 100%"); }
else if (cmd === "uninstall") writeFileSync(f, read().filter((x) => x !== rest[rest.length - 1]).join("\\n"));
`,
  );
  saved = process.env.BRASOS_FLATPAK;
  process.env.BRASOS_FLATPAK = `${process.execPath} ${join(dir, "flatpak.js").split("\\").join("/")}`;
  h = await testHost();
  hardened = await testHost({ packages: ["hardened"] });
});
afterAll(() => {
  h.stop();
  hardened.stop();
  if (saved === undefined) delete process.env.BRASOS_FLATPAK;
  else process.env.BRASOS_FLATPAK = saved;
});

const own = (host: TestHost, id: string) => `http://${id}.localhost:${host.port}`;
const get = (host: TestHost, as: string, path: string) => fetch(`${own(host, "packages")}${path}`, { headers: { origin: own(host, as) } });
const post = (host: TestHost, as: string | null, path: string, body: unknown) =>
  fetch(`${own(host, "packages")}${path}`, { method: "POST", headers: as ? { origin: own(host, as) } : {}, body: JSON.stringify(body) });
const settle = async () => {
  let d: any;
  for (let i = 0; i < 80; i++) {
    d = await (await get(h, "packages", "/flatpak")).json();
    if (d.job.state !== "running") break;
    await Bun.sleep(100);
  }
  return d;
};

test("search text and the tool's output are read strictly", () => {
  expect(safeQuery("steam")).toBe(true);
  expect(safeQuery("video editor")).toBe(true);
  for (const bad of ["", "a;b", "$(x)", "x".repeat(61), "a/b", 5, null]) expect(safeQuery(bad)).toBe(false);
  expect(parseSearch(`${STEAM}\tSteam\tGames\nnot an id\tx\ty\n--help\tx\ty`)).toEqual([{ id: STEAM, name: "Steam", summary: "Games" }]);
  expect(percentOf("Installing… 12%\rInstalling… 45%")).toBe(45);
  expect(percentOf("no progress here")).toBeNull();
});

test("an app installs, shows in the installed list and is removed; start and finish are audited without output", async () => {
  expect((await get(h, "packages", "/flatpak")).status).toBe(200);
  expect((await (await get(h, "packages", "/flatpak")).json()).installed).toEqual([]);
  const s = await (await get(h, "packages", "/flatpak/search?q=steam")).json();
  expect(s.results).toEqual([{ id: STEAM, name: "Steam", summary: "The ultimate game platform" }]);

  expect((await post(h, "packages", "/flatpak/install", { id: STEAM })).status).toBe(202);
  const done = await settle();
  expect(done.job).toMatchObject({ state: "done", action: "install", id: STEAM, percent: 100 });
  expect(done.installed.map((a: any) => a.id)).toEqual([STEAM]);

  expect((await post(h, "packages", "/flatpak/remove", { id: STEAM })).status).toBe(202);
  expect((await settle()).installed).toEqual([]);
  expect((await post(h, "packages", "/flatpak/remove", { id: STEAM })).status).toBe(404); // not installed any more

  const ev = h.events().filter((e) => e.event.startsWith("packages.install."));
  expect(ev.map((e) => e.event)).toEqual(["packages.install.start", "packages.install.finish", "packages.install.start", "packages.install.finish"]);
  expect(JSON.stringify(ev)).not.toContain("Installing");
});

test("only the Packages app changes things, only with a real application id; every other caller is refused", async () => {
  for (const id of ["--user", "com.x", "com.x.Y;rm", "../../x", 5, null]) expect((await post(h, "packages", "/flatpak/install", { id })).status).toBe(400);
  expect((await post(h, "about", "/flatpak/install", { id: STEAM })).status).toBe(403);
  expect((await post(h, null, "/flatpak/install", { id: STEAM })).status).toBe(403);
  expect((await post(h, "evil", "/flatpak/install", { id: STEAM })).status).toBe(403);
  expect((await get(h, "about", "/flatpak")).status).toBe(403);
  expect((await get(h, "about", "/flatpak/search?q=steam")).status).toBe(403);
  expect((await get(h, "packages", "/flatpak/search?q=a;b")).status).toBe(400);
  expect((await settle()).installed).toEqual([]); // nothing above reached the tool
});

test("the hardened package refuses the app store, and without the tool there is none", async () => {
  expect((await post(hardened, "packages", "/flatpak/install", { id: STEAM })).status).not.toBe(202);
  expect((await get(hardened, "packages", "/flatpak/search?q=steam")).status).not.toBe(200);
  delete process.env.BRASOS_FLATPAK;
  const d = await (await get(h, "packages", "/flatpak")).json();
  expect(d.available).toBe(false);
  expect((await post(h, "packages", "/flatpak/install", { id: STEAM })).status).toBe(501);
});
