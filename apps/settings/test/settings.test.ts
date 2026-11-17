import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testHost, type TestHost } from "../../../packages/host/src/testing";
import { parseInput, parseModules, parseOsRelease, parseRfkill, parseVolume, snapshot } from "../server";

const put = (root: string, path: string, text: string) => (mkdirSync(join(root, path, ".."), { recursive: true }), writeFileSync(join(root, path), text));
const fakeRoot = () => {
  const r = mkdtempSync(join(tmpdir(), "brasos-sys-")) + "/";
  put(r, "etc/os-release", 'NAME=NixOS\nPRETTY_NAME="BrasOS 0.1 (NixOS)"\n');
  put(r, "proc/bus/input/devices", 'I: Bus=0011\nN: Name="AT Translated Set 2 keyboard"\nH: Handlers=sysrq kbd event0\n\nI: Bus=0003\nN: Name="QEMU USB Tablet"\nH: Handlers=mouse0 event2\n');
  put(r, "proc/modules", "virtio_gpu 90112 3 - Live 0x0\nvirtio_net 61440 0 - Live 0x0\nsnd_hda_intel 61440 1 snd_hda_codec, Live 0x0\n");
  put(r, "sys/class/drm/card0-Virtual-1/status", "connected\n");
  put(r, "sys/class/drm/card0-Virtual-1/modes", "1280x800\n1024x768\n");
  put(r, "sys/class/drm/card0-HDMI-A-1/status", "disconnected\n");
  put(r, "sys/block/vda/size", "41943040\n");
  put(r, "sys/block/vda/device/model", "QEMU HARDDISK\n");
  put(r, "sys/block/loop0/size", "0\n");
  put(r, "sys/class/net/eth0/address", "52:54:00:12:34:56\n");
  put(r, "sys/class/net/eth0/operstate", "up\n");
  return r;
};

test("the small parsers", () => {
  expect(parseOsRelease('NAME=x\nPRETTY_NAME="BrasOS 0.1"\n')).toBe("BrasOS 0.1");
  expect(parseOsRelease("")).toBe("");
  expect(parseVolume("Volume: 0.60 [MUTED]")).toEqual({ volume: 60, muted: true });
  expect(parseVolume("Volume: 1.00")).toEqual({ volume: 100, muted: false });
  expect(parseVolume("garbage")).toBeNull();
  expect(parseRfkill("0: phy0: Wireless LAN\n\tSoft blocked: yes\n1: hci0: Bluetooth\n\tSoft blocked: yes\n")).toBe(true);
  expect(parseRfkill("0: phy0\n\tSoft blocked: yes\n1: hci0\n\tSoft blocked: no\n")).toBe(false);
  expect(parseRfkill("")).toBeNull();
  expect(parseInput('N: Name="Pad"\nH: Handlers=mouse1\n').map((d) => d.detail)).toEqual(["pointer"]);
  expect(parseModules("a 1 0 - Live 0x0\nb 1 1 a, Live 0x0\n", "6.12")[1]).toMatchObject({ name: "b", device: "a", version: "6.12", loaded: true });
});

test("the snapshot reads devices, drivers and the display from /proc and /sys", () => {
  const s = snapshot(fakeRoot());
  expect(s.info.find(([k]) => k === "System")![1]).toBe("BrasOS 0.1 (NixOS)");
  expect(s.devices.filter((d) => d.group === "Input").map((d) => d.name)).toEqual(["AT Translated Set 2 keyboard", "QEMU USB Tablet"]);
  expect(s.devices.find((d) => d.group === "Storage")).toMatchObject({ name: "QEMU HARDDISK", detail: "vda · 21.5 GB" }); // loop0 is skipped
  expect(s.devices.find((d) => d.group === "Network")).toMatchObject({ name: "eth0", connected: true });
  expect(s.drivers.map((d) => d.name)).toEqual(["snd_hda_intel", "virtio_gpu", "virtio_net"]);
  expect(s.display).toEqual({ name: "Virtual-1", resolutions: ["1280x800", "1024x768"], resolution: "1280x800" });
  // a machine with nothing readable still answers, with nothing made up
  const none = snapshot(mkdtempSync(join(tmpdir(), "brasos-empty-")) + "/");
  expect(none.devices).toEqual([]);
  expect(none.display).toBeNull();
});

let h: TestHost;
let hardened: TestHost;
beforeAll(async () => {
  process.env.BRASOS_SYS_ROOT = fakeRoot();
  h = await testHost();
  hardened = await testHost({ packages: ["hardened"] });
});
afterAll(() => (h.stop(), hardened.stop()));
const own = (host: TestHost, id: string) => `http://${id}.localhost:${host.port}`;
const call = (host: TestHost, as: string, path: string, init: RequestInit = {}) =>
  fetch(`${own(host, "settings")}${path}`, { ...init, headers: { origin: own(host, as), "content-type": "application/json" } });

test("Settings reads the system; other apps and foreign pages are refused", async () => {
  const r = await call(h, "settings", "/system");
  expect(r.status).toBe(200);
  const d = await r.json();
  expect(d.display.name).toBe("Virtual-1");
  expect(d.drivers.length).toBe(3);
  expect("sound" in d && "airplane" in d).toBe(true); // null when there is no wpctl / rfkill: never invented
  expect((await call(h, "about", "/system")).status).toBe(403);
  expect((await call(h, "terminal", "/airplane", { method: "POST", body: JSON.stringify({ on: true }) })).status).toBe(403);
  expect((await fetch(`${own(h, "settings")}/system`, { headers: { origin: "http://evil.com" } })).status).toBe(403);
  expect((await fetch(`${own(h, "settings")}/system`, { headers: { "sec-fetch-site": "same-origin" } })).status).toBe(200);
  expect((await fetch(`${own(h, "settings")}/system`, { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
});

test("writes are validated before anything runs, and audited only when they happen", async () => {
  const post = (path: string, body: unknown) => call(h, "settings", path, { method: "POST", body: JSON.stringify(body) });
  expect((await post("/airplane", { on: "yes" })).status).toBe(400);
  expect((await post("/sound", { volume: 101 })).status).toBe(400);
  expect((await post("/sound", { volume: "loud" })).status).toBe(400);
  expect((await post("/sound", { muted: 1 })).status).toBe(400);
  expect((await post("/sound", {})).status).toBe(400);
  // a valid request on a machine without wpctl/rfkill is "not available", not a success
  const s = (await post("/sound", { volume: 50 })).status;
  expect([200, 501]).toContain(s);
  expect(h.events().some((e) => e.event === "settings.sound")).toBe(s === 200);
  expect(h.events().some((e) => e.event === "capability.settings.write" && e.outcome === "deny")).toBe(true);
});

test("the hardened package has no Settings app", async () => {
  const apps = await hardened.at("localhost", "/os/apps", { headers: { origin: hardened.origin("localhost") } });
  expect((await apps.json()).map((a: any) => a.id)).not.toContain("settings");
  expect((await call(hardened, "settings", "/system")).status).not.toBe(200);
});
