import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The live copy of the interface is replaced by a new build only while it is still what was seeded. The running host writes into its
// own folder (dist, bun.lock), which must not count as an edit: it did once, and no update was ever applied. This runs the module's
// real seed script (its text, taken from module.nix) on a throwaway tree.
const nix = readFileSync(join(import.meta.dir, "../module.nix"), "utf8");
const start = nix.indexOf("src=$1 d=$2");
const body = nix.slice(start, nix.indexOf("\n    '';", start));
const bash = Bun.which("bash");

const dir = mkdtempSync(join(tmpdir(), "brasos-seed-"));
const script = join(dir, "seed.sh").split("\\").join("/");
writeFileSync(script, `set -euo pipefail\n${body}\n`);
const put = (p: string, text: string) => (mkdirSync(join(p, ".."), { recursive: true }), writeFileSync(p, text));
const seed = async (src: string, d: string) => {
  const p = Bun.spawn([bash!, script, src.split("\\").join("/"), d.split("\\").join("/")], { stdout: "pipe", stderr: "pipe" });
  const err = await new Response(p.stderr).text();
  await p.exited;
  return { code: p.exitCode, err };
};

test.skipIf(!bash || start < 0)("an untouched copy takes the new build even after the host has built into it; an edited copy is kept", async () => {
  const a = join(dir, "a"), b = join(dir, "b"), c = join(dir, "c"), live = join(dir, "live");
  put(join(a, "x"), "one");
  put(join(b, "x"), "one");
  put(join(b, "y"), "two");
  put(join(c, "x"), "three");
  expect((await seed(a, live)).code).toBe(0);
  put(join(live, "dist/app.js"), "built by the host"); // what a running host adds
  put(join(live, "bun.lock"), "rewritten");
  put(join(live, "node_modules/m"), "dependency");
  expect((await seed(b, live)).code).toBe(0);
  expect(readdirSync(live).sort()).toEqual([".brasos-seed", "node_modules", "x", "y"]); // new build in, build output gone, dependencies kept
  writeFileSync(join(live, "x"), "edited by the person");
  const r = await seed(c, live);
  expect(readFileSync(join(live, "x"), "utf8")).toBe("edited by the person");
  expect(existsSync(join(live, "y"))).toBe(true);
  expect(r.code).toBe(0);
});
