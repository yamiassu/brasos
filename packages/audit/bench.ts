import type { Bench } from "../../tools/bench-types";
import { createAudit } from "./src/audit";

// cost of recording one audit event (hash + serialize), sink excluded
const bench: Bench = async ({ repeat }) => {
  const audit = createAudit([() => {}]);
  return [{ name: "audit.emit", unit: "ms", samples: await repeat(2000, async () => audit("bench", "info", { app: "x" }, { n: 1 })) }];
};
export default bench;
