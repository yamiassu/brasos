import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testHost, type TestHost } from "../../host/src/testing";
import { parseConnected, parseDevices, parseShow, parseWifi, safeDevice, splitTerse, validWifi } from "../src/nmcli";

test("nmcli's terse output: escaped colons, the strongest entry per network, the connected one first", () => {
  expect(splitTerse("yes:Caf\\:e:70:WPA2")).toEqual(["yes", "Caf:e", "70", "WPA2"]);
  const w = parseWifi("no:Home:40:WPA2\nno:Home:80:WPA2\nyes:Office:30:--\nno::1:WPA2\n");
  expect(w).toEqual([{ ssid: "Office", signal: 30, secure: false, active: true }, { ssid: "Home", signal: 80, secure: true, active: false }]);
});

test("devices and the active connection's details", () => {
  const devs = parseDevices("lo:loopback:unmanaged:\nwlan0:wifi:connected:Home\neth0:ethernet:unavailable:");
  expect(devs).toEqual([{ device: "wlan0", type: "wifi", state: "connected", connection: "Home" }, { device: "eth0", type: "ethernet", state: "unavailable", connection: "" }]);
  expect(parseConnected("loopback:connected\nethernet:unavailable")).toBe(false);
  expect(parseConnected("wifi:connected\nloopback:connected")).toBe(true);
  expect(parseConnected("wlan0:wifi:connected:Home")).toBe(true);
  expect(parseShow("IP4.ADDRESS[1]:192.168.0.5/24\nIP4.GATEWAY:192.168.0.1\nIP4.DNS[1]:1.1.1.1\nIP4.DNS[2]:8.8.8.8")).toEqual({ "IP4.ADDRESS": ["192.168.0.5/24"], "IP4.GATEWAY": ["192.168.0.1"], "IP4.DNS": ["1.1.1.1", "8.8.8.8"] });
  expect(safeDevice("wlan0")).toBe(true);
  expect(safeDevice("wlan0; reboot")).toBe(false);
  expect(safeDevice("-x")).toBe(false);
});

test("only a plausible network name and password are ever handed to nmcli", () => {
  expect(validWifi("Home", "")).toBe(true);
  expect(validWifi("Home", "12345678")).toBe(true);
  expect(validWifi("Home", "short")).toBe(false);
  expect(validWifi("-o", "")).toBe(false);
  expect(validWifi("a\nb", "")).toBe(false);
  expect(validWifi("x".repeat(33), "")).toBe(false);
  expect(validWifi("", "")).toBe(false);
  expect(validWifi("Home", 7)).toBe(false);
});

const tmp = mkdtempSync(join(tmpdir(), "brasos-net-"));
// a fake nmcli is a Bun script (the command is split on spaces: no spaces in these paths)
const fake = join(tmp, "fake-nmcli.js");
writeFileSync(fake, `const a = process.argv.slice(2).join(" ");
if (a.includes("wifi connect")) { console.error("Error: bad secret " + process.argv[process.argv.indexOf("password") + 1]); process.exit(4); }
else if (a.startsWith("-t -f DEVICE,TYPE")) console.log("wlan0:wifi:connected:Home");
else if (a.includes("dev wifi list")) console.log("yes:Home:80:WPA2\\nno:Cafe:40:--");
else if (a.includes("dev show")) console.log("IP4.ADDRESS[1]:192.168.0.5/24\\nIP4.GATEWAY:192.168.0.1\\nIP4.DNS[1]:1.1.1.1");
else if (a.startsWith("radio")) console.log("enabled");
else if (a.startsWith("dev disconnect")) console.log("ok");`);

let h: TestHost, hard: TestHost;
beforeAll(async () => {
  h = await testHost();
  hard = await testHost({ packages: ["hardened"] });
});
afterAll(() => (h.stop(), hard.stop()));
const call = (host: TestHost, from: string, path: string, init: RequestInit = {}) =>
  host.at("localhost", path, { ...init, headers: { origin: host.origin(from), "content-type": "application/json" } });

test("without nmcli the network says so; with it, the shell sees the connection and the networks in range", async () => {
  delete process.env.BRASOS_NMCLI;
  expect((await call(h, "localhost", "/os/network")).status).toBe(501);
  expect((await call(h, "localhost", "/os/network/connect", { method: "POST", body: JSON.stringify({ ssid: "Home" }) })).status).toBe(501);
  process.env.BRASOS_NMCLI = `${process.execPath} ${fake}`;
  const n = await (await call(h, "localhost", "/os/network")).json();
  expect(n).toEqual({ available: true, connected: true, active: { device: "wlan0", type: "wifi", connection: "Home", ip: "192.168.0.5/24", gateway: "192.168.0.1", dns: ["1.1.1.1"], ssid: "Home", signal: 80 }, hasWifi: true, wifiEnabled: true, wifi: [{ ssid: "Home", signal: 80, secure: true, active: true }, { ssid: "Cafe", signal: 40, secure: false, active: false }] });
  expect((await call(h, "localhost", "/os/network/disconnect", { method: "POST" })).status).toBe(200);
});

test("joining a network: checked first, errors never echo the password, and nothing sensitive reaches the audit trail", async () => {
  process.env.BRASOS_NMCLI = `${process.execPath} ${fake}`;
  expect((await call(h, "localhost", "/os/network/connect", { method: "POST", body: JSON.stringify({ ssid: "-bad", password: "" }) })).status).toBe(400);
  expect((await call(h, "localhost", "/os/network/connect", { method: "POST", body: JSON.stringify({ ssid: "Home", password: "short" }) })).status).toBe(400);
  const r = await call(h, "localhost", "/os/network/connect", { method: "POST", body: JSON.stringify({ ssid: "Home", password: "hunter2hunter2" }) });
  expect(r.status).toBe(400);
  expect(JSON.stringify(await r.json())).not.toContain("hunter2hunter2");
  await Bun.sleep(100);
  const trail = JSON.stringify(h.events());
  expect(trail).not.toContain("hunter2hunter2");
  expect(h.events().some((e) => e.event === "network.connect" && e.outcome === "warn")).toBe(true);
});

test("only the shell may use it: apps, foreign pages and the hardened package are refused", async () => {
  process.env.BRASOS_NMCLI = `${process.execPath} ${fake}`;
  for (const from of ["about.localhost", "settings.localhost", "terminal.localhost"]) {
    expect((await call(h, from, "/os/network")).status).toBe(403);
    expect((await call(h, from, "/os/network/connect", { method: "POST", body: JSON.stringify({ ssid: "Home", password: "" }) })).status).toBe(403);
  }
  expect((await h.at("localhost", "/os/network", { headers: { origin: "http://evil.example" } })).status).toBe(403);
  expect((await h.at("localhost", "/os/network", { method: "GET" })).status).toBe(403); // no identifiable caller
  expect((await call(hard, "localhost", "/os/network")).status).toBe(403);
  expect((await call(hard, "localhost", "/os/network/connect", { method: "POST", body: JSON.stringify({ ssid: "Home", password: "" }) })).status).toBe(403);
  expect(h.events().some((e) => e.event === "capability.network.control" && e.outcome === "deny")).toBe(true);
  delete process.env.BRASOS_NMCLI;
});
