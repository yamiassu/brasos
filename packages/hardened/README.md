# hardened

The hardened package: one thing you switch on, with a server half and an OS half.

| Half | Enable with | What it does |
|---|---|---|
| Server (`src/index.ts`) | `BRASOS_PACKAGES=hardened` | Default-deny policy: only apps whose manifest has `"brasos": { "hardened": true }`; only the `apps.read` capability (no terminal, no web gateway, no installing) |
| OS (`module.nix`) | `brasos.hardened.enable = true` (also sets the variable above) | Locked `nologin` user, no sudo, no default packages, firewall and kernel sysctls, dependencies pinned by hash and bundled at build time, immutable sandboxed service (throwaway user, read-only filesystem, no capabilities, syscall filter, loopback only), kiosk browser policy (local shell only, no devtools/extensions/sync), and the Nix source filtered to opted-in apps |

It is mutually exclusive with `brasos.devtools`. The policy can only restrict: every enabled policy must allow.

**Status: work in progress, not audited, not certified.** What is done and what is open (encryption, secure boot, signed updates, admin/MFA, SBOM, a web allowlist, ...) is tracked per requirement in [`docs/compliance/ppsi-mapping.md`](../../docs/compliance/ppsi-mapping.md).

When `bun.lock` changes, the pinned `outputHash` in `module.nix` changes too: set it to `lib.fakeHash`, build, and paste the hash Nix reports.

Tests: `test/hardened.test.ts` runs a real host with the package on and checks that everything dev-only is gone or refused.
