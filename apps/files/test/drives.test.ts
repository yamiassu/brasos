import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testHost, type TestHost } from "../../../packages/host/src/testing";
import { parseDrives } from "../drives";

const lsblk = (devs: unknown[]) => JSON.stringify({ blockdevices: devs });
const DEVS = [
  { path: "/dev/nvme0n1", name: "nvme0n1", size: "1000204886016", model: "Samsung SSD ", type: "disk", rm: false, rota: false, children: [
    { name: "nvme0n1p1", type: "part", size: "536870912", fstype: "vfat", label: "EFI", mountpoints: ["/boot"], fsused: "62914560" },
    { name: "nvme0n1p2", type: "part", size: "999000000000", fstype: "crypto_LUKS", mountpoints: [null], fsused: null, children: [
      { name: "root", type: "crypt", size: "998000000000", fstype: "ext4", label: null, mountpoints: ["/"], fsused: "412000000000" },
    ] },
  ] },
  { path: "/dev/sdb", name: "sdb", size: 31914983424, model: null, type: "disk", rm: "1", rota: "0", children: [{ name: "sdb1", type: "part", size: 31913934848, fstype: "exfat", mountpoints: [null], fsused: null }] },
  { path: "/dev/loop0", name: "loop0", type: "loop", size: 100 },
  { path: "/dev/sr0", name: "sr0", type: "rom", size: 100 },
];

test("parseDrives: whole disks with their volumes, nested ones included; no loop devices or optical drives", () => {
  const d = parseDrives(lsblk(DEVS));
  expect(d.map((x) => x.path)).toEqual(["/dev/nvme0n1", "/dev/sdb"]);
  expect(d[0]).toMatchObject({ model: "Samsung SSD", size: 1000204886016, removable: false, rotational: false });
  expect(d[0].volumes.map((v) => [v.name, v.fs, v.mount, v.used])).toEqual([["nvme0n1p1", "vfat", "/boot", 62914560], ["nvme0n1p2", "crypto_LUKS", null, null], ["root", "ext4", "/", 412000000000]]);
  expect(d[1]).toMatchObject({ removable: true, volumes: [{ mount: null, used: null }] });
  expect(parseDrives("not json")).toEqual([]);
});

const tmp = mkdtempSync(join(tmpdir(), "brasos-drives-"));
let h: TestHost;
let hardened: TestHost;
beforeAll(async () => {
  writeFileSync(join(tmp, "fake-lsblk.js"), `console.log(${JSON.stringify(lsblk(DEVS))})`); // the command is split on spaces: no spaces in these paths
  process.env.BRASOS_DRIVES_LSBLK = `${process.execPath} ${join(tmp, "fake-lsblk.js")}`;
  h = await testHost();
  hardened = await testHost({ packages: ["hardened"] });
});
afterAll(() => (h.stop(), hardened.stop()));
const own = (host: TestHost, id: string) => `http://${id}.localhost:${host.port}`;
const get = (host: TestHost, as: string, id = "files") => fetch(`${own(host, id)}/drives`, { headers: { origin: own(host, as) } });

test("the Files app lists the drives; other apps and foreign pages are refused, and it is audited", async () => {
  const ok = await get(h, "files");
  expect(ok.status).toBe(200);
  expect((await ok.json()).drives.length).toBe(2);
  expect((await get(h, "about")).status).toBe(403);
  expect((await fetch(`${own(h, "files")}/drives`, { headers: { origin: "http://evil.com" } })).status).toBe(403);
  expect((await fetch(`${own(h, "files")}/drives`, { headers: { "sec-fetch-site": "same-origin" } })).status).toBe(200); // a page's own GET carries no Origin
  expect((await fetch(`${own(h, "files")}/drives`, { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
  const e = h.events();
  expect(e.some((x) => x.event === "capability.drives.read" && x.outcome === "allow")).toBe(true);
  expect(e.some((x) => x.event === "capability.drives.read" && x.outcome === "deny")).toBe(true);
});

test("a missing lsblk is an answer (501), not a crash or an invented list", async () => {
  const keep = process.env.BRASOS_DRIVES_LSBLK;
  process.env.BRASOS_DRIVES_LSBLK = join(tmp, "no-such-lsblk");
  try {
    expect((await get(h, "files")).status).toBe(501);
  } finally {
    process.env.BRASOS_DRIVES_LSBLK = keep;
  }
});

test("the hardened package has no Files app and never lists drives", async () => {
  const apps = await hardened.at("localhost", "/os/apps", { headers: { origin: hardened.origin("localhost") } });
  expect((await apps.json()).map((a: any) => a.id)).not.toContain("files");
  expect((await get(hardened, "files")).status).not.toBe(200);
});
