// Tamper-evident audit log: one JSON record per line ("AUDIT {...}"), each carrying the hash of the previous
// record in its instance. Editing, deleting or reordering records breaks the chain (scripts/audit-verify.ts).
// Trust root is the sink: in production the lines go to the systemd journal, which the service cannot rewrite.
// shortcut: truncating the tail of a run is undetectable without anchoring the last hash elsewhere; export the journal regularly.
import { createHash, randomBytes } from "node:crypto";

export const GENESIS = "0".repeat(64);
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export type Sink = (line: string) => void;
export type Outcome = "allow" | "deny" | "info";

export function createAudit(sinks: Sink[]) {
  const instance = randomBytes(6).toString("hex"); // one hash chain per process lifetime
  let seq = 0;
  let prev = GENESIS;
  const limits = new Map<string, { at: number; suppressed: number }>();

  // `limit` throttles floods: the first event in each window is recorded, the rest are counted and reported
  // as `suppressed` on the next recorded event. Keys must come from a bounded set, never raw attacker input.
  return (
    event: string,
    outcome: Outcome,
    actor: Record<string, unknown>,
    detail: Record<string, unknown> = {},
    limit?: { key: string; ms: number },
  ) => {
    if (limit) {
      const now = Date.now();
      const old = limits.get(limit.key);
      if (old && now - old.at < limit.ms) {
        old.suppressed++;
        return;
      }
      limits.set(limit.key, { at: now, suppressed: 0 });
      if (old?.suppressed) detail = { ...detail, suppressed: old.suppressed };
    }
    const rec = { v: 1, instance, seq: ++seq, ts: new Date().toISOString(), event, outcome, actor, detail, prev };
    prev = sha256(JSON.stringify(rec));
    const line = "AUDIT " + JSON.stringify({ ...rec, hash: prev });
    // A failing sink throws on purpose: callers gating a privileged action fail closed when it can't be recorded.
    for (const sink of sinks) sink(line);
  };
}
