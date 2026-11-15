# BrasOS

A Linux-based operating system whose entire user interface is React and TypeScript. Apps are PWAs, every app runs isolated, the shell and apps are meant to be customizable by anyone, performance is measured from day one, and the long-term target is use on Brazilian government computers.

> **Status: early foundation. Not for real use.**
> The **dev** profile is insecure by design (default password, passwordless root, an AI agent with full privilege). The **hardened** package is a work in progress: it has been booted in a VM, but it has not been audited, penetration-tested or certified, and it still lacks encryption, secure boot, signed updates and an admin/MFA story. Do not describe either as secure or compliant.

## What exists today

- **A React shell** (windows, dock, per-window error boundaries) served by a small Bun host and shown full-screen by Chromium inside a Wayland kiosk (`cage`).
- **Apps are PWAs.** Each app is a Web App Manifest plus an optional `brasos` block (icon, permissions, hardened opt-in), in its own iframe on its own origin (`<app>.localhost`), so Chromium isolates it in a separate process. A heartbeat detects a hung app; the shell stays responsive and offers Restart.
- **A browser that loads TypeScript sites.** The browser app opens websites through a gateway that gives each one its own secure-context origin (so service workers and PWAs work), serves `.ts` files as JavaScript, and funnels every web request through one audited, SSRF-checked chokepoint. A site with a manifest can be **installed** as an app.
- **`@brasos/sdk`**: one small package that talks to the OS from a page and degrades to polyfills on a normal browser. Also served as a script and injected into websites.
- **A desktop and a file browser.** Desktop icons for every app and for whatever is in `/Desktop`; a Files app with keyboard navigation, create/rename/delete (to a trash), and text and image preview with editing. Files are confined to one home folder.
- **An interface for AI agents.** A standard MCP endpoint plus the shell's own UI tools: one call (`ui_snapshot`) returns the whole screen, so an agent can drive the OS with typed actions instead of screenshots. Token-authenticated, never reachable from a web page, audited, and off in the hardened package. WebMCP is supported as a best-effort adapter ([docs/guide/07-agents.md](docs/guide/07-agents.md)).
- **A UI kit** (`@brasos/ui`) with the basic components and design tokens the shell and apps are built from, and **in-OS documentation**: nine guides in `docs/guide/` shown in the Docs app.
- **One capability gate** in the host: callers are identified by their browser-set `Origin`, permissions come from manifests, and every decision is audited. A terminal app (xterm.js on a real PTY) exists in the dev profile so Claude Code or any CLI runs inside the OS.
- **A hardened package** you switch on (`brasos.hardened.enable`, `BRASOS_PACKAGES=hardened`), mutually exclusive with the dev conveniences.
- **A hash-chained audit trail** with a verifier that detects edited, deleted or reordered records ([docs/audit.md](docs/audit.md)).
- **Tests and benchmarks per slice** (`bun test`, `bun run bench`), and scripts to build, boot and drive the VM headlessly.
- **A compliance mapping** of the hardened package's requirements to Brazil's PPSI 2.0 framework ([docs/compliance/ppsi-mapping.md](docs/compliance/ppsi-mapping.md)).

Planned (see the roadmap in [AGENTS.md](AGENTS.md)): a Rust Wayland compositor so native Linux apps run beside the React UI, a richer SDK and capability broker, a web allowlist so the gateway can run in the hardened package, a window manager, deeper customization, OS-level app sandboxes (Flatpak/portals), and a custom renderer to replace Chromium.

## Quick start

You need [Bun](https://bun.sh) 1.4+. This runs the OS shell in any browser, on Windows, macOS or Linux:

```bash
bun install
bun run dev        # http://localhost:7000
bun test           # every slice's tests
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
| Apps | all, including terminal, browser and files | only apps that opt in (`"brasos": { "hardened": true }`): About and Docs today |
| Terminal / files / AI agents / web gateway | yes | no (capabilities denied, terminal code not even loaded) |
| Dependencies | fetched at boot | fetched at build time, pinned by hash |
| OS copy | user-editable, with a pristine-copy fallback | immutable, runs from the Nix store |
| Server | normal user | throwaway user, read-only filesystem, no capabilities, syscall filter, loopback only |
| Browser | unrestricted | only the local shell; no devtools, extensions or sync |
| Marker | orange "DEV · not secure" badge | none |

## Repository layout

The repo is organized by what BrasOS does. Each slice owns its server code, UI, Nix module, tests and benchmarks.

```
packages/
  host/          composition root: origins, the capability gate, static serving, build
  shell/         the React desktop
  registry/      the app list: built-in apps and installed PWAs
  web-gateway/   websites through the host; TypeScript served as JavaScript; SSRF checks
  sdk/           @brasos/sdk, with polyfills outside BrasOS
  ui/            @brasos/ui: basic components and design tokens
  files/         the user's files (confined to one home), as routes and agent tools
  docs/          the guides, rendered from docs/guide/*.md
  agent/         the MCP endpoint and the relay to the shell's UI tools
  audit/         tamper-evident audit trail and verifier
  hardened/      the hardened package (server policy + NixOS module)
  devtools/      development conveniences (NixOS module)
apps/            about, browser, crash-test, docs, files, terminal (each a PWA manifest + UI + optional server slice)
nixos/base.nix   kiosk session, fonts, VM settings
flake.nix        one NixOS system per profile
tools/           benchmark runner
scripts/vm/      build, boot and drive the test VM
docs/            guide/ (the in-OS user and developer guides), architecture, audit trail, compliance mapping
AGENTS.md        contracts, ownership, working rules (read this first when contributing)
```

## Documentation

- [docs/guide/](docs/guide/01-welcome.md): the user and developer guides (also shown inside the OS in the Docs app).
- [AGENTS.md](AGENTS.md): the contracts that must not break, who owns what, definition of done, roadmap, known gaps. Written for both humans and AI coding agents.
- [docs/architecture.md](docs/architecture.md): how the pieces fit, trust boundaries, the hardened build pipeline.
- Each slice has a README: [host](packages/host/README.md), [shell](packages/shell/README.md), [registry](packages/registry/README.md), [web-gateway](packages/web-gateway/README.md), [sdk](packages/sdk/README.md), [ui](packages/ui/README.md), [files](packages/files/README.md), [docs](packages/docs/README.md), [agent](packages/agent/README.md), [audit](packages/audit/README.md), [hardened](packages/hardened/README.md), [devtools](packages/devtools/README.md), [browser](apps/browser/README.md).
- [docs/audit.md](docs/audit.md): the audit trail format, verification and limits.
- [docs/compliance/ppsi-mapping.md](docs/compliance/ppsi-mapping.md): requirements R1–R24 against PPSI 2.0 measures, with honest status.
- [SECURITY.md](SECURITY.md): how to report a vulnerability.
- [CONTRIBUTING.md](CONTRIBUTING.md): how to contribute.

## Compliance target

Brazilian federal government use. The mapping cites PPSI 2.0 (SGD/MGI), which adopts CIS Controls v8.1, plus the GSI/PR norms and ICP-Brasil where relevant. PPSI measures are questions an agency answers about its own practices, so an OS can only help an agency answer "yes" and supply evidence; it cannot be "PPSI compliant" by itself. The mapping uses measure numbers and our own wording and does not reproduce the official guide, which is licensed CC BY-NC-ND 4.0. It is not legal advice.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md). Short version: one worktree per change, keep `bun test` green, every new privileged capability goes through the host's gate, is audited, is tested for both allow and deny (with and without the hardened package), and has a benchmark.

## License

Apache License 2.0. See [LICENSE](LICENSE). The compliance mapping cites measure numbers from the official PPSI guide, which has its own license (CC BY-NC-ND 4.0) and is not included here.
