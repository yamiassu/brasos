// Publishes a BrasOS update: the source tarball of the working tree (tracked + untracked, never ignored files) and the manifest that
// points at it, to an S3 bucket the installed systems read anonymously (brasos.updates.url). Run it yourself with the bucket's keys in
// the environment; nothing secret is stored in the repo:
//   S3_ENDPOINT=https://s3.upuai.cloud S3_BUCKET=updates-xxxx S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... bun tools/update-server/publish.ts [notes]
// The manifest ends up at <S3_ENDPOINT>/<S3_BUCKET>/manifest.json (override the public base with S3_PUBLIC_URL).
import { S3Client } from "bun";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const env = (k: string) => process.env[k] || (console.error(`missing ${k}`), process.exit(2));
const sh = (cmd: string[]) => {
  const r = Bun.spawnSync(cmd, { stderr: "inherit" });
  if (r.exitCode !== 0) throw new Error(`${cmd[0]} failed`);
  return r.stdout.toString().trim();
};

// DRY_RUN=<dir>: build the tarball and manifest into that directory and upload nothing (no keys needed)
const dry = process.env.DRY_RUN;
const endpoint = dry ? "https://example.invalid" : env("S3_ENDPOINT"), bucket = dry ? "dry" : env("S3_BUCKET");
const s3 = dry ? null : new S3Client({ endpoint, bucket, accessKeyId: env("S3_ACCESS_KEY_ID"), secretAccessKey: env("S3_SECRET_ACCESS_KEY") });
const base = (process.env.S3_PUBLIC_URL ?? `${endpoint}/${bucket}`).replace(/\/$/, "");

const rev = sh(["git", "rev-parse", "--short", "HEAD"]);
const dirty = sh(["git", "status", "--porcelain"]) ? "-dirty" : "";
const version = `${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${rev}${dirty}`;
const files = sh(["git", "ls-files", "-co", "--exclude-standard"]).split("\n").filter(Boolean);
const dir = mkdtempSync(join(tmpdir(), "brasos-pub-"));
const list = join(dir, "files.txt"), tarball = join(dir, `brasos-${version}.tar.gz`);
await Bun.write(list, files.join("\n") + "\n");
sh(["tar", "--force-local", "-czf", tarball, "--transform", "s,^,brasos/,", "-T", list]); // GNU tar; on Windows run it from WSL
const manifest = { version, flake: `${base}/brasos-${version}.tar.gz`, notes: process.argv[2] ?? "" };
if (dry) {
  await Bun.write(join(dry, `brasos-${version}.tar.gz`), Bun.file(tarball));
  await Bun.write(join(dry, "manifest.json"), JSON.stringify(manifest));
} else {
  await s3!.write(`brasos-${version}.tar.gz`, Bun.file(tarball));
  await s3!.write("manifest.json", JSON.stringify(manifest), { type: "application/json" }); // last: the manifest only points at a tarball that is already there
}
console.log(`published ${version}: ${files.length} files, ${(readFileSync(tarball).length / 1e6).toFixed(1)} MB\n${base}/manifest.json`);
