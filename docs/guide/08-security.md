# Security

> BrasOS is not a finished or certified system. This page describes what exists; it is not a claim of compliance.

## The model in five lines

1. Every app and website is its own browser origin, in its own process.
2. Powerful actions are **capabilities** that an app must declare in its manifest.
3. One check in the host decides every request: who is asking (from the browser-set origin), whether the manifest allows it, and whether an enabled package forbids it.
4. Every decision is written to a hash-chained **audit trail**.
5. The server listens only on the local machine and rejects any other address.

## Dev and hardened

| | Dev image | Hardened image |
|---|---|---|
| Login | User `brasos`, default password, passwordless root | No usable login, no sudo |
| Apps | All, including terminal and browser | Only apps that opt in |
| Terminal, files, web gateway, installing, agents | On | Off |
| Dependencies | Fetched at boot | Fetched at build time and pinned by hash |
| Server | Normal user | Throwaway user, read-only disk, no capabilities, restricted system calls |
| Browser | Unrestricted | Only the local shell; no developer tools, extensions or sync |

The dev image is for building BrasOS. Never put anything real on it.

## The first account

On first start the installer creates one account: a name, a username, and a password stored only as an argon2id hash in the state folder (readable only by the service). The password locks the shell; it is not access control, because every program on the machine can reach the local server. Wrong passwords are audited and rate-limited (five a minute). The hardened image keeps the installer and the lock screen, since a machine still needs its first account.

## Files and the web

- Files are confined to one home folder. `..` cannot climb out, and a link inside the home that points outside is refused.
- The web gateway is the only way the system reaches the internet. It refuses private, local and cloud-metadata addresses, limits time and size, and re-checks every redirect.

## Verifying the audit trail

```
journalctl -u brasos-shell -o cat | grep '^AUDIT' | bun packages/audit/src/verify.ts
```

It reports `OK` or says which record was altered, missing or out of order. The log is evidence of tampering, not protection against it: the protection is that the service cannot rewrite the system journal.

## Known gaps

No disk encryption, secure boot, signed updates, or admin and multi-factor sign-in yet. Shell and command-line activity inside the terminal are not audited. The hardened image has not been audited or penetration-tested. The full list, mapped to Brazil's PPSI 2.0 framework, is in `docs/compliance/ppsi-mapping.md` in the repository.

## Reporting a vulnerability

Do not open a public issue. Use the repository's private vulnerability reporting. Details are in `SECURITY.md`.
