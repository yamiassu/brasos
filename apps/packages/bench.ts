import type { Bench } from "../../tools/bench-types";
import { buildPackages, parsePathInfo } from "./server";

// walking a system's store graph (3000 paths, the top 150 linked into the profile): done once a minute at most while the app is open
const bench: Bench = async () => {
  const path = (i: number) => `/nix/store/${String(i).padStart(32, "a")}-pkg${i}-1.0`;
  const g: Record<string, { narSize: number; references: string[] }> = {};
  for (let i = 0; i < 3000; i++) g[path(i)] = { narSize: 1e6, references: [path(i), ...[1, 7, 31].map((k) => path(Math.min(2999, i + k)))] };
  const info = parsePathInfo(JSON.stringify(g)), top = Array.from({ length: 150 }, (_, i) => path(i * 20));
  const samples: number[] = [];
  for (let i = 0; i < 20; i++) {
    const t = performance.now();
    buildPackages(info, top);
    samples.push(performance.now() - t);
  }
  return [{ name: "packages.build", unit: "ms", samples }];
};
export default bench;
