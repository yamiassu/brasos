# BrasOS

A Linux-based operating system whose entire user interface is React and TypeScript. Every app runs isolated, the shell and apps are meant to be customizable by anyone, performance is measured from day one, and the long-term target is use on Brazilian government computers.

> **Status: early foundation. Not for real use.**
> The **dev** profile is insecure by design (default password, passwordless root, an AI agent with full privilege). The **hardened** profile is a work in progress: it has been booted in a VM, but it has not been audited, penetration-tested or certified, and it still lacks encryption, secure boot, signed updates and an admin/MFA story. Do not describe either as secure or compliant.

## What exists today

- **A React shell** (windows, dock, per-window error boundaries) served by a small Bun server and shown full-screen by Chromium inside a Wayland kiosk (`cage`).
- **Apps in iframes, one origin each** (`<app>.localhost`), so Chromium isolates them in separate processes. A heartbeat detects a hung or crashed app; the shell stays responsive and offers Restart.
- **A terminal app** (xterm.js on a real PTY) in the dev profile, so Claude Code or any CLI runs inside the OS.
- **Two NixOS profiles** built from one flake: `brasos-dev` and `brasos-hardened`. Apps opt in to the hardened profile through their manifest (default deny).
- **A hash-chained audit trail** of privileged decisions, with a verifier that detects edited, deleted or reordered records ([docs/audit.md](docs/audit.md)).
- **Contract tests and a benchmark harness** (`bun run test`, `bun run bench`), and scripts to build, boot and drive the VM headlessly.
- **A compliance mapping** of the hardened profile's requirements to Brazil's PPSI 2.0 framework ([docs/compliance/ppsi-mapping.md](docs/compliance/ppsi-mapping.md)).

Planned (see the roadmap in [AGENTS.md](AGENTS.md)): a Rust Wayland compositor so native Linux apps run beside the React UI, an app SDK with a capability broker, a window manager, deeper customization, OS-level app sandboxes (Flatpak/portals), and a custom renderer to replace Chromium.

## Quick start

You need [Bun](https://bun.sh) 1.4+. This runs the shell in any browser, on Windows, macOS or Linux:

```bash
cd shell
bun install
bun run dev        # http://localhost:7000
bun run test       # contract tests for both profiles
bun run bench      # latency benchmarks
```

To build and boot the actual OS image in a VM you need Linux or WSL2 with [Nix](https://nixos.org) (flakes enabled) and KVM. Clone the repo inside WSL's own filesystem, not under `/mnt/c`:

```bash
scripts/vm/run.sh                    # dev profile; PROFILE=hardened for the other
scripts/vm/ctl.py shot out.png       # screenshot the VM (from the repo root)
scripts/vm/ctl.py key tab tab ret    # drive it with the keyboard
```

Details and WSL2 caveats are in [AGENTS.md](AGENTS.md).

## Profiles

| | dev | hardened |
|---|---|---|
| Login | user `brasos`, default password, passwordless sudo | no usable login, no sudo |
| Terminal / AI agent | yes | no |
| Dependencies | fetched at boot | fetched at build time, pinned by hash |
| Shell | user-editable, with a pristine-copy fallback | immutable, runs from the Nix store |
| Shell service | normal user | throwaway user, read-only filesystem, no capabilities, syscall filter, loopback only |
| Browser | unrestricted | only the local shell; no devtools, extensions or sync |
| Marker | orange "DEV PROFILE · not secure" badge | none |

## Repository layout

```
shell/            Bun server, React shell, apps, audit module, tests and benchmarks
nixos/            base.nix (shared) and profiles/{dev,hardened}.nix
flake.nix         one NixOS system per profile
scripts/vm/       build, boot and drive the test VM
docs/             architecture, audit trail, compliance mapping
AGENTS.md         contracts, ownership, working rules (read this first when contributing)
```

## Documentation

- [AGENTS.md](AGENTS.md): the contracts that must not break, who owns what, definition of done, roadmap, known gaps. Written for both humans and AI coding agents.
- [docs/architecture.md](docs/architecture.md): how the pieces fit, trust boundaries, the hardened build pipeline.
- [docs/audit.md](docs/audit.md): the audit trail format, verification and limits.
- [docs/compliance/ppsi-mapping.md](docs/compliance/ppsi-mapping.md): requirements R1–R21 against PPSI 2.0 measures, with honest status.
- [SECURITY.md](SECURITY.md): how to report a vulnerability.
- [CONTRIBUTING.md](CONTRIBUTING.md): how to contribute.

## Compliance target

Brazilian federal government use. The mapping cites PPSI 2.0 (SGD/MGI), which adopts CIS Controls v8.1, plus the GSI/PR norms and ICP-Brasil where relevant. PPSI measures are questions an agency answers about its own practices, so an OS can only help an agency answer "yes" and supply evidence; it cannot be "PPSI compliant" by itself. The mapping uses measure numbers and our own wording and does not reproduce the official guide, which is licensed CC BY-NC-ND 4.0. It is not legal advice.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md). Short version: one worktree per change, keep the contract tests green, every new privileged capability is gated server-side, audited, tested for both allow and deny, and has a benchmark.

## License

No license has been chosen yet, so by default all rights are reserved even though the source is visible. A `LICENSE` file will be added once the maintainers decide; until then, please open an issue before reusing the code.
