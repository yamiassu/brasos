import type { Bench } from "../../tools/bench-types";
import { createRecovery } from "./src/recovery";

// the page the kiosk falls back to: it must render at once even when everything else is broken
const bench: Bench = async ({ repeat }) => {
  const handle = createRecovery({ port: 7001, commands: { restart: ["r"], logs: ["l"] }, uiUrl: "http://x/", audit: () => {}, probe: async () => false });
  return [{ name: "recovery.page", unit: "ms", samples: await repeat(200, async () => (await handle(new Request("http://localhost:7001/"))).text()) }];
};
export default bench;
