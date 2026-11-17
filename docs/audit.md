# Audit trail

Implements PPSI-mapping requirement **R4** (`docs/compliance/ppsi-mapping.md`). Code: `packages/audit/src/audit.ts`, verifier `packages/audit/src/verify.ts`.

## What is recorded

One line per event on the shell server's stdout, prefixed `AUDIT `, followed by a JSON record:

```json
{"v":1,"instance":"136853403001","seq":2,"ts":"2026-11-15T03:22:53.354Z","event":"app.load","outcome":"allow",
 "actor":{"app":"about"},"detail":{},"prev":"<hash of previous record>","hash":"<sha-256 of this record without hash>"}
```

Under systemd the stdout lands in the journal; `BRASOS_AUDIT_FILE=<path>` adds a file copy (the tests use this).

| Event | Outcome | Meaning | Throttle |
|---|---|---|---|
| `server.start` | info | Process started: enabled packages, port, apps served | none |
| `request.rejected` | deny | Host header not `localhost`/`*.localhost` | 1 per 10 s |
| `app.unknown` | deny | Request to the origin of an app that isn't available (not installed, or filtered out by a package) | 1 per 10 s |
| `app.load` | allow | An app's index document was loaded (a window opened) | 1 per second per app |
| `capability.<name>` | allow / deny | Every decision of the host's gate: `pty`, `apps.read`, `apps.install`, `apps.uninstall`, `web.open`. Actor is the caller (`shell`, an app id, `site`, `unknown`) and its origin | denials 1 per second per capability and caller |
| `fs.change` | info | A file change: the operation (`write`, `mkdir`, `move`, `delete`), the path, and which app did it. Reads are covered by the throttled `capability.fs.read` allows | none |
| `agent.auth` | deny | An agent request refused: bad or missing token, or a browser `Origin` | 1 per 5 s |
| `agent.tool` | info | An agent tool call: the tool name, success, duration. **Never its arguments** | none |
| `pty.session` | info | Terminal session open/close, pid, duration | none |
| `web.open` | allow / deny | A site was opened (host name) or refused (reason) | 1 per second |
| `web.site` | allow | First request to a site (per minute): host name | 1 per minute per site |
| `web.blocked`, `web.error` | deny | The gateway refused an upstream address, or the upstream failed | 1 per 5 s |
| `system.rebuild`, `system.app_create` | info | The OS rebuilt its apps from source, or created an app (id only) | none |
| `apps.install` | info | A PWA was installed: id, name, start URL, the permissions it requested and the ones the user granted | none |

Capabilities that only read (`apps.read`, `fs.read`, `docs.read`, `ui.host`) throttle their *allow* events to one per second per caller, with a `suppressed` count; their *denials* are throttled the same way, and every write-like capability is audited each time.

Throttled events are counted and the next recorded event carries `suppressed: N`, so a flood can't fill the journal silently. Allows of privileged capabilities are never throttled.

## Verifying

```bash
journalctl -u brasos-shell -o cat | grep '^AUDIT' | bun packages/audit/src/verify.ts
bun packages/audit/src/verify.ts exported.log
```

Exit 0 and `OK: N events, M instance(s)` if intact. It fails on an edited record, a deleted or reordered one, a broken link, or an empty trail. Each process lifetime is its own chain (`instance`), so a restart starts a new chain at `seq` 1.

## What this does and does not give you

- **Tamper-evident, not tamper-proof.** The hash chain has no secret key: anyone who can rewrite the whole log can recompute a consistent chain. The protection comes from where the lines live: the systemd journal is not writable by the service (a throwaway user in the hardened profile). Anchor the last hash off the machine to detect tail truncation.
- **Journal config** (`packages/audit/module.nix`): persistent storage and no rate limiting, because a dropped line would be a silent gap. Gaps inside a run are also caught by the `seq` check.
- **Fails closed for the action it guards:** if a sink throws, the request that was being audited errors out rather than proceeding unrecorded.
- **Clock:** timestamps come from the system clock. NixOS runs `systemd-timesyncd` by default; that is not verified in our image.

## Not covered yet (open work)

Shell UI actions (window open/close happen in the browser), commands typed in the terminal (PPSI 8.8), authentication and admin changes (there is no login yet), file access, configuration changes and updates, central export to an agency SIEM (8.9), a retention period (8.10; a policy decision for the customer), a log review process (8.11), and signing or off-box anchoring of the chain.

## Adding an event

Privileged routes call `ctx.gate(cap)`, which audits its decision. For anything else, call `audit(event, outcome, actor, detail, limit?)` for every privileged decision, allow and deny. Keep `actor`/`detail` bounded (truncate anything attacker-controlled; throttle keys must come from a bounded set). Add the event to the table above and a check in the slice's tests.
