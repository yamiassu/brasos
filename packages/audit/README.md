# audit

A tamper-evident audit trail: one JSON record per line (`AUDIT {...}`), each carrying the hash of the previous record of its process lifetime. Editing, deleting or reordering records breaks the chain.

- `src/audit.ts`: `createAudit(sinks)`; throttling with `suppressed` counts; a failing sink makes the guarded action fail.
- `src/verify.ts`: `verifyAudit(text)` and a CLI: `journalctl -u brasos-shell -o cat | grep '^AUDIT' | bun packages/audit/src/verify.ts`.
- `module.nix`: persistent, never rate-limited journald, so the service can't rewrite or silently lose its own trail.

Format, event list, limits and open work: [`docs/audit.md`](../../docs/audit.md). Requirement R4 in [`docs/compliance/ppsi-mapping.md`](../../docs/compliance/ppsi-mapping.md).

Tests: `test/audit.test.ts`. Benchmark: `bench.ts` (`audit.emit`).
