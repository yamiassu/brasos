# Audit trail

Implements PPSI-mapping requirement **R4** (`docs/compliance/ppsi-mapping.md`). Code: `shell/audit.ts`, verifier `shell/scripts/audit-verify.ts`.

## What is recorded

One line per event on the shell server's stdout, prefixed `AUDIT `, followed by a JSON record:

```json
{"v":1,"instance":"136853403001","seq":2,"ts":"2026-11-15T03:22:53.354Z","event":"app.load","outcome":"allow",
 "actor":{"app":"about"},"detail":{},"prev":"<hash of previous record>","hash":"<sha-256 of this record without hash>"}
```

Under systemd the stdout lands in the journal; `BRASOS_AUDIT_FILE=<path>` adds a file copy (the tests use this).

| Event | Outcome | Meaning | Throttle |
|---|---|---|---|
| `server.start` | info | Process started: profile, port, apps served | none |
| `request.rejected` | deny | Host header not `localhost`/`*.localhost` | 1 per 10 s |
| `app.unknown` | deny | Request to the origin of an app that isn't in this profile | 1 per 10 s |
| `app.load` | allow | An app's index document was loaded (a window opened) | 1 per second per app |
| `capability.pty` | allow / deny | Terminal capability requested: actor app and origin | denials 1 per second per app |
| `pty.session` | info | Terminal session open/close, pid, duration | none |

Throttled events are counted and the next recorded event carries `suppressed: N`, so a flood can't fill the journal silently. Allows of privileged capabilities are never throttled.

## Verifying

```bash
journalctl -u brasos-shell -o cat | grep '^AUDIT' | bun shell/scripts/audit-verify.ts
bun shell/scripts/audit-verify.ts exported.log
```

Exit 0 and `OK: N events, M instance(s)` if intact. It fails on an edited record, a deleted or reordered one, a broken link, or an empty trail. Each process lifetime is its own chain (`instance`), so a restart starts a new chain at `seq` 1.

## What this does and does not give you

- **Tamper-evident, not tamper-proof.** The hash chain has no secret key: anyone who can rewrite the whole log can recompute a consistent chain. The protection comes from where the lines live: the systemd journal is not writable by the service (a throwaway user in the hardened profile). Anchor the last hash off the machine to detect tail truncation.
- **Journal config** (`nixos/base.nix`): persistent storage and no rate limiting, because a dropped line would be a silent gap. Gaps inside a run are also caught by the `seq` check.
- **Fails closed for the action it guards:** if a sink throws, the request that was being audited errors out rather than proceeding unrecorded.
- **Clock:** timestamps come from the system clock. NixOS runs `systemd-timesyncd` by default; that is not verified in our image.

## Not covered yet (open work)

Shell UI actions (window open/close happen in the browser), commands typed in the terminal (PPSI 8.8), authentication and admin changes (there is no login yet), file access, configuration changes and updates, central export to an agency SIEM (8.9), a retention period (8.10; a policy decision for the customer), a log review process (8.11), and signing or off-box anchoring of the chain.

## Adding an event

Call `audit(event, outcome, actor, detail, limit?)` for every privileged decision, allow and deny. Keep `actor`/`detail` bounded (truncate anything attacker-controlled; throttle keys must come from a bounded set). Add the event to the table above and a check in `shell/scripts/smoke.ts`.
