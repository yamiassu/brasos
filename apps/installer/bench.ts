import type { Bench } from "../../tools/bench-types";
import { parseDisks, parseWifi } from "./server";

// Turning `lsblk` output into the disk list the installer offers (the part that runs on every open of the app).
const bench: Bench = async () => {
  const dev = (i: number) => ({ path: `/dev/sd${String.fromCharCode(97 + (i % 26))}`, size: "512110190592", model: "Disk", type: "disk", rm: false, mountpoints: [null], children: [{ path: "x", type: "part", mountpoints: [null] }] });
  const out = JSON.stringify({ blockdevices: Array.from({ length: 8 }, (_, i) => dev(i)) });
  const samples: number[] = [];
  for (let i = 0; i < 200; i++) {
    const t = performance.now();
    parseDisks(out);
    samples.push(performance.now() - t);
  }
  const wifi = Array.from({ length: 40 }, (_, i) => `no:Net${i % 25}:${i * 2}:WPA2`).join("\n");
  const ws: number[] = [];
  for (let i = 0; i < 200; i++) {
    const t = performance.now();
    parseWifi(wifi);
    ws.push(performance.now() - t);
  }
  return [{ name: "installer.parse_disks", unit: "ms", samples }, { name: "installer.parse_wifi", unit: "ms", samples: ws }];
};
export default bench;
