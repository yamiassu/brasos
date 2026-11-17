// Entry point. Environment: PORT (default 7001), BRASOS_UI_URL (the desktop to probe), BRASOS_RECOVERY_ACTIONS (JSON: action -> argv; set by the image).
import { createAudit } from "@brasos/audit";
import { createRecovery } from "./recovery";

const env = process.env;
const port = Number(env.PORT ?? 7001);
const audit = createAudit([(l) => console.log(l)]);
const handle = createRecovery({
  port,
  commands: JSON.parse(env.BRASOS_RECOVERY_ACTIONS ?? "{}"),
  uiUrl: env.BRASOS_UI_URL ?? "http://127.0.0.1:7000/",
  audit,
});
Bun.serve({ hostname: "127.0.0.1", port, fetch: handle });
audit("recovery.start", "info", {}, { port });
