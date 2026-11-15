# Contributing to BrasOS

Thanks for helping. The authoritative working rules live in [AGENTS.md](AGENTS.md); this is the short version.

## Setup

```bash
cd shell && bun install
bun run test       # must pass before and after your change
bun run dev        # http://localhost:7000
```

Changes under `nixos/` or `flake.nix` also need `scripts/vm/build.sh` to succeed for **both** profiles (`PROFILE=hardened` for the second). That needs Linux or WSL2 with Nix.

## Workflow

1. Open an issue (or comment on one) describing the change, especially for anything touching the contracts in `AGENTS.md`.
2. One git worktree and branch per change: `git worktree add ../brasos-<topic> -b <topic>` from `main`.
3. Keep commits small and focused. Rebase on `main` before opening a pull request. Don't reformat code you aren't changing.
4. Stay inside the area you're changing. Shared files (`shell/server.ts`, `nixos/base.nix`, `shell/apps/sdk.ts`, `AGENTS.md`) are merge-conflict hotspots: keep those diffs minimal and mention them in the PR.

## What a good pull request contains

- Passing `bun run test`, and a new check for new behavior. For a privileged capability: tests for both the allowed and the refused case, in **both** profiles.
- Audit events for every privileged decision, allow and deny (`docs/audit.md`).
- A benchmark for anything new that runs code (`bun run bench`; `AGENTS.md` explains the harness).
- Documentation updated in the same PR: a new contract goes in `AGENTS.md`; a change to a security requirement updates its row in `docs/compliance/ppsi-mapping.md`.
- For UI changes, evidence you used the feature, not just that it type-checks.

## Security-sensitive changes

Default deny. No new network listeners beyond loopback. No runtime fetching of code in the hardened profile. No secrets in the repo. New dependencies need a justification, because each one is supply-chain risk. See "Security posture" in `AGENTS.md`.

To report a vulnerability, **don't** open a public issue: see [SECURITY.md](SECURITY.md).

## Licensing of contributions

No license has been chosen yet (see the README). By contributing you agree your contribution can be released under whichever license the maintainers choose.
