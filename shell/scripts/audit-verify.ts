// `bun scripts/audit-verify.ts [file]` (or pipe in `journalctl -u brasos-shell -o cat`). Exit 1 if the trail is broken.
import { GENESIS, sha256 } from "../audit";

export function verifyAudit(text: string): { ok: boolean; events: number; instances: number; error?: string } {
  const lines = text.split("\n").filter((l) => l.startsWith("AUDIT "));
  const chains = new Map<string, { seq: number; prev: string }>();
  let n = 0;
  for (const line of lines) {
    n++;
    let obj: any;
    try {
      obj = JSON.parse(line.slice(6));
    } catch {
      return { ok: false, events: n, instances: chains.size, error: `record ${n}: not valid JSON` };
    }
    const { hash, ...rec } = obj;
    if (sha256(JSON.stringify(rec)) !== hash) {
      return { ok: false, events: n, instances: chains.size, error: `record ${n} (${rec.event}): contents were altered` };
    }
    const c = chains.get(rec.instance) ?? { seq: 0, prev: GENESIS };
    if (rec.seq !== c.seq + 1) {
      return { ok: false, events: n, instances: chains.size, error: `record ${n}: instance ${rec.instance} expected seq ${c.seq + 1}, got ${rec.seq} (records missing or reordered)` };
    }
    if (rec.prev !== c.prev) {
      return { ok: false, events: n, instances: chains.size, error: `record ${n}: chain link broken in instance ${rec.instance}` };
    }
    chains.set(rec.instance, { seq: rec.seq, prev: hash });
  }
  return { ok: true, events: n, instances: chains.size };
}

if (import.meta.main) {
  const file = process.argv[2];
  const r = verifyAudit(file ? await Bun.file(file).text() : await Bun.stdin.text());
  console.log(r.ok ? `OK: ${r.events} events, ${r.instances} instance(s)` : `BROKEN: ${r.error}`);
  process.exit(r.ok && r.events > 0 ? 0 : 1); // an empty trail is also a failure: something should always be there
}
