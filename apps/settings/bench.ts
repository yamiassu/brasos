import type { Bench } from "../../tools/bench-types";
import { snapshot } from "./server";
import { parseManifest } from "./updates";

// the cost of one Settings refresh (read /proc and /sys): it runs when the app opens and every 10 s after
const bench: Bench = async () => {
  const samples: number[] = [];
  for (let i = 0; i < 50; i++) {
    const t = performance.now();
    snapshot();
    samples.push(performance.now() - t);
  }
  const text = JSON.stringify({ version: "2026.11.16", flake: "https://example.com/brasos.tar.gz?narHash=sha256-abc%3D", notes: "x" });
  const parse: number[] = [];
  for (let i = 0; i < 2000; i++) {
    const t = performance.now();
    parseManifest(text);
    parse.push(performance.now() - t);
  }
  return [{ name: "settings.snapshot", unit: "ms", samples }, { name: "settings.parse_manifest", unit: "ms", samples: parse }];
};
export default bench;
