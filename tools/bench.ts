// `bun run bench [--out results.json] [--compare baseline.json]`
// Starts one host, then runs every slice's bench.ts (packages/*/bench.ts, apps/*/bench.ts): each exports a default
// `Bench` (see tools/bench-types.ts). Numbers are only comparable on the same machine/platform.
import { Glob } from "bun";
import { join } from "node:path";
import { testHost } from "../packages/host/src/testing";
import type { Bench, Result } from "./bench-types";

const arg = (f: string) => {
  const i = process.argv.indexOf(f);
  return i < 0 ? undefined : process.argv[i + 1];
};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const repeat = async (n: number, fn: () => Promise<unknown>) => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    await fn();
    out.push(performance.now() - t);
  }
  return out;
};

const root = join(import.meta.dir, "..");
const t0 = performance.now();
const host = await testHost({ gateway: { allowPrivate: true } });
const results: Result[] = [{ name: "host.start_to_ready", unit: "ms", samples: [performance.now() - t0] }]; // includes the full app build

try {
  for (const pattern of ["packages/*/bench.{ts,tsx}", "apps/*/bench.{ts,tsx}"]) {
    for await (const file of new Glob(pattern).scan({ cwd: root })) {
      const bench: Bench = (await import(join(root, file))).default;
      results.push(...(await bench({ host, repeat, sleep })));
    }
  }
} finally {
  host.stop();
}

const pct = (s: number[], p: number) => [...s].sort((a, b) => a - b)[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
const stats = (r: Result) => ({ n: r.samples.length, p50: pct(r.samples, 50), p95: pct(r.samples, 95), max: Math.max(...r.samples) });
console.log("name".padEnd(28), "unit", "     n      p50      p95      max");
for (const r of results) {
  const s = stats(r);
  console.log(r.name.padEnd(28), r.unit.padEnd(4), String(s.n).padStart(6), ...[s.p50, s.p95, s.max].map((v) => v.toFixed(2).padStart(8)));
}
const out = arg("--out");
if (out) await Bun.write(out, JSON.stringify({ platform: process.platform, results }, null, 2));

// Regression gate: p50 more than 25% (and 1 unit) worse than the baseline fails the run.
const compare = arg("--compare");
if (compare) {
  const base = await Bun.file(compare).json();
  let bad = 0;
  for (const r of results) {
    const b = base.results.find((x: Result) => x.name === r.name);
    if (!b) continue;
    const now = stats(r).p50;
    const was = stats(b).p50;
    if (now > was * 1.25 && now - was > 1) {
      console.log(`REGRESSION ${r.name}: p50 ${was.toFixed(2)} -> ${now.toFixed(2)} ${r.unit}`);
      bad++;
    }
  }
  process.exit(bad ? 1 : 0);
}
process.exit(0);
