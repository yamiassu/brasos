import { expect, test } from "bun:test";
import { assertPublicHost, isPrivateIp } from "../src/address";

const PRIVATE = [
  "127.0.0.1", "127.255.255.254", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
  "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1",
  "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%eth0", "ff02::1",
  "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "::ffff:a9fe:a9fe", "64:ff9b::7f00:1",
  "not-an-ip",
];
const PUBLIC = ["8.8.8.8", "1.1.1.1", "172.32.0.1", "172.15.255.255", "100.63.255.255", "2606:4700:4700::1111", "::ffff:8.8.8.8", "[2001:4860:4860::8888]"];

test.each(PRIVATE)("%s is refused", (ip) => expect(isPrivateIp(ip)).toBe(true));
test.each(PUBLIC)("%s is allowed", (ip) => expect(isPrivateIp(ip)).toBe(false));

test("private hostnames and literals are blocked before any request", async () => {
  for (const h of ["localhost", "app.localhost", "printer.local", "db.internal", "127.0.0.1", "[::1]", "169.254.169.254"]) {
    await expect(assertPublicHost(h)).rejects.toThrow();
  }
});

test("a public literal passes without DNS, and the test escape hatch lets private ones through", async () => {
  await assertPublicHost("8.8.8.8");
  await assertPublicHost("127.0.0.1", true);
});
