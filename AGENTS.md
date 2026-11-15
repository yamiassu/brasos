# BrasOS

A Linux-based OS whose entire UI is React/TypeScript. Linux kernel + NixOS userspace; Bun runs the system services; Chromium (kiosk, under `cage`) renders the shell for now. Goal: performance first, every app isolated, every app and the shell itself user-customizable, and any Linux app runnable. Details of the long-term plan are in "Roadmap" below.

## Layout and ownership

| Path | What | Notes |
|---|---|---|
| `shell/server.ts` | Bun server: builds shell+apps, serves each on its own origin, owns the PTY | Security boundary. Read "Contracts" before changing |
| `shell/shell/` | React shell: windows, dock, `shell.css` (tokens), `user.css` (user overrides) | Windows host apps as iframes |
| `shell/apps/<id>/` | One app: `manifest.json`, `index.html`, `main.ts(x)` | Must `import "../sdk"` |
| `shell/apps/sdk.ts` | What every app imports (heartbeat reply today; the app SDK will grow here) | |
| `shell/scripts/smoke.ts` | Contract tests (`bun run test`) | |
| `nixos/base.nix` | Shared by every profile: kiosk session, fonts, VM settings | |
| `nixos/profiles/dev.nix`, `nixos/profiles/hardened.nix` | The two profiles (see "Profiles") | Hardened pins a dependency hash: update it when `shell/bun.lock` changes |
| `flake.nix` | One system per profile: `brasos-dev`, `brasos-hardened` | `flake.lock` pins nixpkgs: commit it |
| `scripts/vm/` | Build, boot and drive the VM | |

## Contracts (do not break without updating this file and the smoke test)

1. **One origin per app.** App `<id>` is served at `http://<id>.localhost:<port>`; the shell is `http://localhost:<port>`. A restarted window uses `<id>--<n>.localhost` (fresh origin, so a fresh process). The server derives the app from the Host header.
2. **Capabilities are gated by app id and Origin, server-side.** Today the only one: `/pty` is available to `terminal` only, and only if the `Origin` header matches. A new privileged capability needs the same two checks plus a line in `smoke.ts` proving other apps and foreign origins are refused. Never gate in client code.
3. **The server binds to `127.0.0.1` and rejects any Host that is not `localhost` or `*.localhost`.** The PTY is full user access; do not widen this.
4. **Heartbeat.** The shell sends `"ping"` via `postMessage`; apps (via `sdk.ts`) answer `"pong"`. No pong for 8 s = the shell shows "isn't responding" with Restart/Close. A hung app must never affect the shell.
5. **Window chrome is wrapped in an error boundary;** a throwing window must not take down the shell.
6. **Dev profile only: the live shell is user-editable** at `/var/lib/brasos/shell` in the VM (seeded from the repo on first boot). If it fails 3 times in 60 s, systemd starts the pristine copy (`brasos-shell-safe`). `brasos-reset-shell` re-seeds. Keep that fallback working when you touch the services. The hardened shell is immutable and runs from the Nix store.
7. **Dev profile only: Claude Code has full privilege by design** (user `brasos` has passwordless sudo, default password). The hardened profile has no terminal, no agent, no sudo and no usable login.
8. **Apps opt in to the hardened profile** with `"profiles": ["dev", "hardened"]` in `manifest.json`; the default is dev only. In hardened, the server never builds at runtime, never serves a non-opted-in app and never exposes `/pty`. `smoke.ts` tests both profiles: a new app or capability needs a hardened-profile check too.

## Commands

```bash
cd shell && bun install && bun run dev      # shell at http://localhost:7000 (works on Windows/macOS/Linux)
cd shell && bun run test                    # contract tests, ~5 s
cd shell && bun run bench [--out f.json] [--compare baseline.json]   # benchmarks; --compare exits 1 on >25% p50 regression
scripts/vm/build.sh                         # build the NixOS VM (Linux/WSL, clone inside WSL's own fs); PROFILE=hardened for the other one
scripts/vm/run.sh                           # boot it from a clean disk; keep it running (PROFILE=dev|hardened)
scripts/vm/ctl.py shot out.png              # screenshot the VM (from repo root)
scripts/vm/ctl.py key tab tab ret           # Tab to the Terminal dock button + Enter
scripts/vm/ctl.py type "whoami"             # type into the focused terminal
```

WSL2 specifics (already handled in the config, listed so you don't re-debug): QEMU's GL display crashes under WSLg, virtiofs fails, so the VM uses a plain display and a baked store image; your user must be in the `kvm` group; the VM dies when the launching WSL session exits.

## Definition of done

- `bun run test` passes.
- Touching `nixos/` or `flake.nix`: `scripts/vm/build.sh` succeeds for **both** profiles, and for anything user-visible, boot it and look (`ctl.py shot`).
- Touching UI: open it in a browser at `http://localhost:7000` and use the feature; type checks passing is not evidence it works.
- Anything new that runs code (a component, service, app, capability) ships with a benchmark (see below).
- A new contract, capability or convention gets written here in the same commit.

## Benchmarking (requirement: every part is measurable)

`shell/scripts/bench.ts` is the harness: each bench records `{name, unit, samples[]}`, the runner prints n/p50/p95/max, writes JSON with `--out`, and fails on regressions with `--compare`. Naming: `<component>.<metric>`. Today: `server.start_to_ready`, `http.*`, `pty.keystroke_echo`. Add benches next to the code they measure; measure latency distributions (p95/max), not just averages. Numbers are comparable only on the same machine and platform, so keep baselines per platform and don't commit one from a laptop as "truth".

Not yet measured (open work): window open time and frame time in Chromium, per-app RSS and cold start, boot time to shell-ready in the VM (`systemd-analyze`), input-to-photon latency, build time. VM-level benches belong in `scripts/vm/` and should use `ctl.py`.

## Profiles

- **dev** (`brasos-dev`): everything convenient and deliberately insecure; the dock shows "DEV PROFILE · not secure" so nobody mistakes it.
- **hardened** (`brasos-hardened`): work in progress toward the requirements below. Today it has: no credentials and no sudo (locked `nologin` user), no terminal or dev apps, dependencies fetched at build time and pinned by hash (nothing fetched at boot), the shell bundled at build time and run from the immutable store, a sandboxed shell service (throwaway user, read-only filesystem, no capabilities, syscall filter, loopback-only), a kiosk browser policy (only the local shell, no devtools, extensions or sync), kernel sysctl hardening, no default packages. It has been booted in the VM; it has not been audited or penetration-tested, and it still lacks audit logging, encryption, secure boot, signed updates and an admin/MFA story.

## Security posture (requirement: government-grade)

**Current status: the hardened profile is a start, not a finished or certified system. The dev profile is not secure.** Do not describe either as secure or compliant anywhere. Target jurisdiction: **Brazil** (federal/state government computers). Nothing here is certified, audited or mapped yet; the threat model is still an open decision.

### Brazilian regime (from web search, Nov 2026; confirm with the customer's security officer and legal before relying on any of it)

- **PPSI** (Programa de Privacidade e Segurança da Informação, SGD/MGI): original Portaria SGD/MGI nº 852/2023, now **PPSI 2.0 via Portaria SGD/MGI nº 9.511 of 28 Oct 2025**, for federal bodies in SISP. The framework guide (v1.2, 30 Jan 2026, read in full) adopts CIS Controls v8.1 entirely for security (controls 1–18, 153 measures), plus Control 0 (governance) and controls 19–25 (privacy/LGPD). Measures are questions an agency answers about itself, so BrasOS supports them rather than "being compliant".
- **GSI/PR** norms: PNSI is **Decreto nº 12.572/2025** (the PPSI guide cites it as the current reference), IN GSI/PR nº 1/2020 (each body must have a security policy, POSIN), nº 3/2021 (mandatory security-management processes), nº 5/2021 (minimum requirements for cloud), and nº 9/2026 (added to the PPSI guide's reference norms; not read).
- **ICP-Brasil** (ITI): if the OS signs or handles digital certificates, DOC-ICP-10 and the Manuais de Condutas Técnicas (MCT 5 authentication software, MCT 7 cryptographic modules) apply and require homologation.
- **LGPD** (Lei 13.709/2018) for personal data, and a separate regime for classified information. Not researched here.
- No mandatory national OS certification scheme was found. Common Criteria and NIST SP 800 appear as international references. Whether the customer demands a certification is a question for them, not an assumption for us.

The hardened-profile requirements are mapped to PPSI measures in [`docs/compliance/ppsi-mapping.md`](docs/compliance/ppsi-mapping.md) (R1–R21, with status and open questions). Keep it current: a change that adds, removes or satisfies a requirement updates its row in the same commit. The guide is CC BY-NC-ND: cite measure numbers and use our own words, never paste its text.

Dev-only conveniences that a hardened profile must not have: user `brasos` with a default password and passwordless sudo; Claude Code with full privilege; `bun install` from the network at boot; a user-editable shell that runs unreviewed code; Chromium kiosk with a shell that has a full-access PTY.

Rules for all work, starting now:
- Default deny. Every privileged capability is gated server-side by app id + Origin and covered by a negative test in `smoke.ts` (refusal must be tested, not just success).
- No new network listeners beyond loopback; no runtime fetching of code or dependencies in anything meant for the hardened profile. Dependencies must be pinned and reviewable (Nix closure, lockfiles). Treat each new dependency as supply-chain risk and justify it.
- No secrets, keys or credentials in the repo or the image.
- Privileged actions must be loggable (an audit trail is planned): route them through one place, not scattered call sites.
- Prefer separation by process and by OS mechanisms (users, namespaces, Landlock, seccomp, MAC) over in-process checks.

Hardened-profile work (open): a NixOS profile switch (dev vs hardened), reproducible builds + SBOM, secure/measured boot (TPM), full-disk encryption, signed updates with rollback, mandatory access control for services, audit logging, removal of the dev conveniences above, and a decision on what privilege an AI agent (Claude Code) gets on such a system.

## Working in parallel

- One git worktree per agent: `git worktree add ../brasos-<topic> -b agent/<topic>`. Branch from `main`; rebase on `main` before merging; keep commits small and focused.
- Stay inside your area (table above). If you must touch a shared file (`server.ts`, `configuration.nix`, `sdk.ts`, this file), keep the diff minimal and mention it in the commit message, since those are the merge-conflict hotspots.
- Don't reformat or reorganize code you aren't changing.
- `.vm/` is per worktree (disk + monitor socket), so several VMs can run side by side; each needs ~4 GB RAM.

## Roadmap (independent areas agents can pick up)

1. **Compositor + native Linux apps:** replace `cage` with a Rust smithay compositor (XWayland), Chromium as one client, native app windows composed beside it; Flatpak + XDG portals for foreign apps. Largest item.
2. **App SDK and capability API:** manifest permissions, a `postMessage` RPC from apps to a privileged shell broker (files, network, notifications), replacing ad hoc endpoints. Lives in `sdk.ts` + `server.ts`.
3. **Window manager:** minimize/maximize, snapping, per-window focus handling, keyboard navigation (the pointer can't be driven in tests, so keyboard parity matters).
4. **Customization:** theme tokens, user component overrides with hot reload, per-user layers (system → user → app), error-safe reload.
5. **Claude Code integration:** decide its permission tier, first-class launcher, auth flow.
6. **Performance:** measure and budget boot time, input latency, idle RAM per app; zygote-style forking of a preloaded Bun runtime; custom renderer replacing Chromium later.

## Known gaps

- Pointer input can't be driven in the VM test harness (use keyboard).
- No GPU in the VM yet (software rendering); native Linux hosts can switch the QEMU options to `virtio-vga-gl` (see comment in `configuration.nix`).
- Process separation per app is by design (distinct origins under Chromium site isolation) but not yet verified with `chrome://process-internals`.
- Apps are rebuilt only when the server restarts.
- Safe-mode fallback is tested only by reasoning, not yet by deliberately breaking the live shell in the VM.
