# Security policy

BrasOS is an early foundation. There are no supported releases yet, and no security guarantees are made. See the status note in the [README](README.md).

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private vulnerability reporting: on the repository page, go to **Security → Report a vulnerability**. Include what you found, how to reproduce it, which profile (dev or hardened) and which commit.

Reports are handled on a best-effort basis; there is no response-time commitment at this stage.

## What is in scope

- The **hardened** package (`packages/hardened/`) and the behavior the contracts in [AGENTS.md](AGENTS.md) promise: origin isolation between apps, the host's capability gate, loopback-only listening, the audit trail's integrity, the build pipeline.
- The host (`packages/host/`) and the web gateway (`packages/web-gateway/`) in either profile: a flaw that lets one app or web page reach a capability it should not have (for example the terminal), a way to make the gateway reach private or loopback addresses (SSRF), or to escape a site's origin.
- The agent interface (`packages/agent/`): any way to use `/mcp` or the shell relay without the token, from a web page, or in the hardened package; and the files slice (`packages/files/`): any way to read or write outside the user's home.

## What is not a vulnerability

The **dev** profile is insecure by design: a default password, passwordless sudo, an AI agent with full privilege, a terminal, boot-time dependency fetching and a user-editable shell are documented, intentional conveniences. Reports that only say "the dev image lets me run commands as root" are expected behavior.

Known gaps in the hardened profile (no disk encryption, secure boot, signed updates, admin/MFA, shell-UI audit events and more) are tracked in [docs/compliance/ppsi-mapping.md](docs/compliance/ppsi-mapping.md); you don't need to report those, though a concrete exploit of one is welcome.

## Disclosure

Please give us reasonable time to fix an issue before publishing details. We'll credit reporters who want credit.
