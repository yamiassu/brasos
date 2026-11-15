// SSRF defence: the gateway fetches on behalf of web pages, so it must never reach loopback, private,
// link-local or metadata addresses on the machine's network.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class BlockedError extends Error {}

const isPrivateV4 = (ip: string) => {
  const [a, b, c] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast and reserved
  );
};

function expandV6(ip: string): number[] {
  const dotted = ip.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dotted) ip = dotted[1] + ((+dotted[2] << 8) | +dotted[3]).toString(16) + ":" + ((+dotted[4] << 8) | +dotted[5]).toString(16);
  const [head, tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const zeros = ip.includes("::") ? 8 - h.length - t.length : 0;
  return [...h, ...Array(zeros).fill("0"), ...t].map((x) => parseInt(x, 16));
}

/** true for anything that is not a plain public unicast address; anything unparseable counts as private (fail closed) */
export function isPrivateIp(raw: string): boolean {
  const ip = raw.replace(/^\[|\]$/g, "").replace(/%.*$/, "").toLowerCase();
  if (isIP(ip) === 4) return isPrivateV4(ip);
  if (isIP(ip) !== 6) return true;
  const h = expandV6(ip);
  if (h.slice(0, 7).every((x) => x === 0)) return true; // :: and ::1
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) return isPrivateV4(`${h[6] >> 8}.${h[6] & 255}.${h[7] >> 8}.${h[7] & 255}`);
  return (
    h[0] >> 9 === 0x7e || // fc00::/7 unique local
    (h[0] & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    h[0] >> 8 === 0xff || // multicast
    (h[0] === 0x64 && h[1] === 0xff9b) // NAT64 can embed a private v4
  );
}

// shortcut: resolve-then-fetch leaves a DNS-rebinding window; pin the resolved IP once Bun's fetch can connect to a chosen address
export async function assertPublicHost(hostname: string, allowPrivate = false): Promise<void> {
  if (allowPrivate) return;
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || /\.(localhost|local|internal)$/.test(h)) throw new BlockedError("private hostname");
  const addrs = isIP(h) ? [{ address: h }] : await lookup(h, { all: true }).catch(() => []);
  if (!addrs.length) throw new BlockedError("host does not resolve");
  if (addrs.some((a) => isPrivateIp(a.address))) throw new BlockedError("address is not public");
}
