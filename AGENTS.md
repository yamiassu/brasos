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
| `nixos/configuration.nix`, `flake.nix` | The OS image | `flake.lock` pins nixpkgs: commit it |
| `scripts/vm/` | Build, boot and drive the VM | |

## Contracts (do not break without updating this file and the smoke test)

1. **One origin per app.** App `<id>` is served at `http://<id>.localhost:<port>`; the shell is `http://localhost:<port>`. A restarted window uses `<id>--<n>.localhost` (fresh origin, so a fresh process). The server derives the app from the Host header.
2. **Capabilities are gated by app id and Origin, server-side.** Today the only one: `/pty` is available to `terminal` only, and only if the `Origin` header matches. A new privileged capability needs the same two checks plus a line in `smoke.ts` proving other apps and foreign origins are refused. Never gate in client code.
3. **The server binds to `127.0.0.1` and rejects any Host that is not `localhost` or `*.localhost`.** The PTY is full user access; do not widen this.
4. **Heartbeat.** The shell sends `"ping"` via `postMessage`; apps (via `sdk.ts`) answer `"pong"`. No pong for 8 s = the shell shows "isn't responding" with Restart/Close. A hung app must never affect the shell.
5. **Window chrome is wrapped in an error boundary;** a throwing window must not take down the shell.
6. **The live shell is user-editable** at `/var/lib/brasos/shell` in the VM (seeded from the repo on first boot). If it fails 3 times in 60 s, systemd starts the pristine copy (`brasos-shell-safe`). `brasos-reset-shell` re-seeds. Keep that fallback working when you touch the services.
7. **Claude Code has full privilege by design** (user `brasos` has passwordless sudo). Fine for the VM; revisit before bare metal.

## Commands

```bash
cd shell && bun install && bun run dev      # shell at http://localhost:7000 (works on Windows/macOS/Linux)
cd shell && bun run test                    # contract tests, ~5 s
cd shell && bun run bench [--out f.json] [--compare baseline.json]   # benchmarks; --compare exits 1 on >25% p50 regression
scripts/vm/build.sh                         # build the NixOS VM (Linux/WSL, clone inside WSL's own fs)
scripts/vm/run.sh                           # boot it from a clean disk; keep it running
scripts/vm/ctl.py shot out.png              # screenshot the VM (from repo root)
scripts/vm/ctl.py key tab tab ret           # Tab to the Terminal dock button + Enter
scripts/vm/ctl.py type "whoami"             # type into the focused terminal
```

WSL2 specifics (already handled in the config, listed so you don't re-debug): QEMU's GL display crashes under WSLg, virtiofs fails, so the VM uses a plain display and a baked store image; your user must be in the `kvm` group; the VM dies when the launching WSL session exits.

## Definition of done

- `bun run test` passes.
- Touching `nixos/` or `flake.nix`: `scripts/vm/build.sh` succeeds, and for anything user-visible, boot it and look (`ctl.py shot`).
- Touching UI: open it in a browser at `http://localhost:7000` and use the feature; type checks passing is not evidence it works.
- Anything new that runs code (a component, service, app, capability) ships with a benchmark (see below).
- A new contract, capability or convention gets written here in the same commit.

## Benchmarking (requirement: every part is measurable)

`shell/scripts/bench.ts` is the harness: each bench records `{name, unit, samples[]}`, the runner prints n/p50/p95/max, writes JSON with `--out`, and fails on regressions with `--compare`. Naming: `<component>.<metric>`. Today: `server.start_to_ready`, `http.*`, `pty.keystroke_echo`. Add benches next to the code they measure; measure latency distributions (p95/max), not just averages. Numbers are comparable only on the same machine and platform, so keep baselines per platform and don't commit one from a laptop as "truth".

Not yet measured (open work): window open time and frame time in Chromium, per-app RSS and cold start, boot time to shell-ready in the VM (`systemd-analyze`), input-to-photon latency, build time. VM-level benches belong in `scripts/vm/` and should use `ctl.py`.

## Security posture (requirement: government-grade)

**Current status: NOT hardened. What exists today is a development profile.** Do not describe it as secure or compliant anywhere. No compliance standard has been chosen yet (jurisdiction and threat model are open decisions), so nothing here is certified or audited.

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
