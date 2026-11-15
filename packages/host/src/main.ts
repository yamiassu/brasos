// Entry point. Configuration comes from the environment: PORT, BRASOS_PACKAGES (e.g. "hardened"), BRASOS_DIST,
// BRASOS_PREBUILT, BRASOS_STATE_DIR, BRASOS_HOME, BRASOS_AUDIT_FILE, BRASOS_RESTART_CMD (the supervisor's restart command), BRASOS_WEB_ALLOW_PRIVATE (tests/dev only), and --build-only.
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { startHost } from "./host";

const env = process.env;
const buildOnly = process.argv.includes("--build-only");
const auditFile = env.BRASOS_AUDIT_FILE;

const host = await startHost({
  root: join(import.meta.dir, "../../.."),
  port: Number(env.PORT ?? 7000),
  packages: (env.BRASOS_PACKAGES ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  dist: env.BRASOS_DIST,
  prebuilt: !!env.BRASOS_PREBUILT,
  buildOnly,
  stateDir: env.BRASOS_STATE_DIR,
  home: env.BRASOS_HOME,
  restart: env.BRASOS_RESTART_CMD ? () => void Bun.spawn([env.BRASOS_RESTART_CMD!], { stdio: ["ignore", "ignore", "ignore"] }) : undefined,
  gateway: { allowPrivate: env.BRASOS_WEB_ALLOW_PRIVATE === "1" },
  // stdout goes to the journal under systemd; BRASOS_AUDIT_FILE adds a file copy
  audit: [(l) => console.log(l), ...(auditFile ? [(l: string) => appendFileSync(auditFile, l + "\n")] : [])],
});
if (!buildOnly) console.log(`BrasOS shell on http://localhost:${host.port}`);
