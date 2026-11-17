import type { Bench } from "../../tools/bench-types";
import { parseDrives } from "./drives";

// parsing `lsblk -J` for a busy machine (12 disks with 6 volumes each): it runs each time the Drives category is opened
const bench: Bench = async () => {
  const out = JSON.stringify({ blockdevices: Array.from({ length: 12 }, (_, i) => ({ path: `/dev/sd${i}`, name: `sd${i}`, size: "1000204886016", model: "Disk", type: "disk", rm: false, rota: true, children: Array.from({ length: 6 }, (_, j) => ({ name: `sd${i}${j}`, type: "part", size: "100000000", fstype: "ext4", mountpoints: [`/mnt/${i}${j}`], fsused: "5000000" })) })) });
  const parse: number[] = [];
  for (let i = 0; i < 200; i++) {
    const t = performance.now();
    parseDrives(out);
    parse.push(performance.now() - t);
  }
  return [{ name: "files.parse_drives", unit: "ms", samples: parse }];
};
export default bench;
