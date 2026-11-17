import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testHost, type TestHost } from "../../../packages/host/src/testing";
import { parseDisks, progress } from "../server";

const lsblk = (devs: unknown[]) => JSON.stringify({ blockdevices: devs });
const tmp = mkdtempSync(join(tmpdir(), "brasos-inst-"));
// a fake command is a Bun script, so the tests run the same on every OS (the command is split on spaces: no spaces in these paths)
const script = (name: string, body: string) => (writeFileSync(join(tmp, name), body), `${process.execPath} ${join(tmp, name)}`);

test("parseDisks lists whole disks nothing is mounted from, and never the stick", () => {
  const out = lsblk([
    { path: "/dev/sda", size: "512110190592", model: "Samsung SSD ", type: "disk", rm: false, mountpoints: [null], children: [{ path: "/dev/sda1", type: "part", mountpoints: [null] }] },
    { path: "/dev/sdb", size: "16000000000", model: "USB stick", type: "disk", rm: true, mountpoints: [null], children: [{ path: "/dev/sdb1", type: "part", mountpoints: ["/iso"] }] },
    { path: "/dev/loop0", type: "loop", mountpoints: [null] },
    { path: "/dev/sr0; rm -rf /", type: "disk", mountpoints: [null] },
    { path: "/dev/nvme0n1", size: 1000204886016, model: null, type: "disk", rm: "0", mountpoints: [null] },
  ]);
  expect(parseDisks(out).map((d) => d.path)).toEqual(["/dev/sda", "/dev/nvme0n1"]);
  expect(parseDisks(out)[0]).toEqual({ path: "/dev/sda", size: 512110190592, model: "Samsung SSD", removable: false, rotational: false, parts: [{ label: "Partition", sizeGB: 0, fs: "", kind: "" }] });
  expect(parseDisks("not json")).toEqual([]);
});

test("progress follows the markers and the copied paths, and never goes backwards or past 100", () => {
  const st = { phase: 0, total: 0, copied: 0 };
  const seen = ["@phase 0", "@phase 1", "@total 4", "@phase 2", "copying path 'a' to 'local'...", "copying path 'b' to 'local'...", "installing the boot loader...", "@phase 4"].map((l) => progress(l, st));
  expect(seen).toEqual([0, 5, 5, 15, 33, 50, 85, 95]);
  expect(seen.every((v, i) => i === 0 || v >= seen[i - 1])).toBe(true);
  for (let i = 0; i < 20; i++) progress("copying path 'x' to 'local'...", st);
  expect(progress("", { phase: 2, total: 4, copied: 99 })).toBe(85);
});

let h: TestHost;
let hardened: TestHost;
beforeAll(async () => {
  process.env.BRASOS_INSTALLER_CMD = "";
  h = await testHost();
  hardened = await testHost({ packages: ["hardened"] });
});
afterAll(() => (h.stop(), hardened.stop()));
const own = (host: TestHost, id: string) => `http://${id}.localhost:${host.port}`;
const call = (host: TestHost, as: string, path: string, init: RequestInit = {}) =>
  fetch(`${own(host, "installer")}${path}`, { ...init, headers: { origin: own(host, as), "content-type": "application/json" } });

test("without an install image there is no installer, even for the installer app", async () => {
  expect((await call(h, "installer", "/disks")).status).toBe(501);
});

test("only the installer app may use it: other apps and foreign pages are refused", async () => {
  expect((await call(h, "about", "/disks")).status).toBe(403);
  expect((await call(h, "terminal", "/install", { method: "POST", body: "{}" })).status).toBe(403);
  const evil = await fetch(`${own(h, "installer")}/disks`, { headers: { origin: "http://evil.com" } });
  expect(evil.status).toBe(403);
  // a page's own GET (no Origin, Sec-Fetch-Site) is identified; a cross-site one is not
  expect((await fetch(`${own(h, "installer")}/disks`, { headers: { "sec-fetch-site": "same-origin" } })).status).toBe(501);
  expect((await fetch(`${own(h, "installer")}/disks`, { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
});

test("the hardened package refuses it outright", async () => {
  expect((await call(hardened, "installer", "/disks")).status).not.toBe(200);
  expect((await call(hardened, "installer", "/install", { method: "POST", body: JSON.stringify({ disk: "/dev/sda" }) })).status).toBeGreaterThanOrEqual(400);
});

test("installs only a listed disk, runs once, reports the output and can reboot only afterwards", async () => {
  process.env.BRASOS_INSTALLER_CMD = script("fake-install.js", 'console.log(`installing ${process.argv.slice(2).join(" ")}`); console.log("@phase 2"); console.log("@total 2"); console.log("copying path a to local..."); await Bun.sleep(1000); console.log("BRASOS INSTALLED");');
  process.env.BRASOS_INSTALLER_LSBLK = script("fake-lsblk.js", `console.log(${JSON.stringify(lsblk([{ path: "/dev/vdb", size: 20e9, model: "QEMU", type: "disk", mountpoints: [null] }]))});`);
  expect((await (await call(h, "installer", "/disks")).json()).disks.map((d: any) => d.path)).toEqual(["/dev/vdb"]);
  for (const disk of ["/dev/sda", "/dev/vdb; reboot", "", 7]) {
    expect((await call(h, "installer", "/install", { method: "POST", body: JSON.stringify({ disk }) })).status).toBe(400);
  }
  for (const swapGB of [-1, 2.5, 65, "4", "2; reboot"]) {
    expect((await call(h, "installer", "/install", { method: "POST", body: JSON.stringify({ disk: "/dev/vdb", swapGB }) })).status).toBe(400);
  }
  expect((await call(h, "installer", "/reboot", { method: "POST" })).status).toBe(409); // nothing installed yet
  expect((await call(h, "installer", "/install", { method: "POST", body: JSON.stringify({ disk: "/dev/vdb", swapGB: 2 }) })).status).toBe(202);
  expect((await call(h, "installer", "/install", { method: "POST", body: JSON.stringify({ disk: "/dev/vdb" }) })).status).toBe(409); // one at a time
  let s: any;
  for (let i = 0; i < 50 && s?.state !== "done"; i++) (await Bun.sleep(100), (s = await (await call(h, "installer", "/status")).json()));
  expect(s.state).toBe("done");
  expect(s.log).toContain("installing --yes --swap 2 /dev/vdb");
  expect(s.percent).toBe(100);
  expect(s.phase).toBe(4);
  expect(s.log).toContain("BRASOS INSTALLED");
});

test("the decisions and the install are audited, the output is not", async () => {
  await Bun.sleep(200);
  const e = h.events();
  expect(e.some((x) => x.event === "capability.installer.run" && x.outcome === "allow" && x.actor.app === "installer")).toBe(true);
  expect(e.some((x) => x.event === "capability.installer.run" && x.outcome === "deny")).toBe(true);
  expect(e.some((x) => x.event === "installer.start" && x.detail.disk === "/dev/vdb")).toBe(true);
  expect(e.some((x) => x.event === "installer.finish" && x.detail.exit === 0)).toBe(true);
  expect(JSON.stringify(e)).not.toContain("BRASOS INSTALLED");
  // hardened: the app is not even installed (default deny), so there is nothing to call
  const apps = await hardened.at("localhost", "/os/apps", { headers: { origin: hardened.origin("localhost") } });
  expect((await apps.json()).map((a: any) => a.id)).not.toContain("installer");
});

test("a missing lsblk is an answer the page can show, not a crash", async () => {
  const keep = [process.env.BRASOS_INSTALLER_CMD, process.env.BRASOS_INSTALLER_LSBLK];
  process.env.BRASOS_INSTALLER_CMD = script("fake-install2.js", "console.log('x');");
  process.env.BRASOS_INSTALLER_LSBLK = join(tmp, "no-such-lsblk");
  try {
    const r = await call(h, "installer", "/disks");
    expect(r.status).toBe(500);
    expect((await r.json()).error).toContain("could not list its disks");
    expect((await call(h, "installer", "/install", { method: "POST", body: JSON.stringify({ disk: "/dev/vdb" }) })).status).toBe(400); // nothing is installable when nothing is listed
  } finally {
    [process.env.BRASOS_INSTALLER_CMD, process.env.BRASOS_INSTALLER_LSBLK] = keep as [string, string];
  }
});
