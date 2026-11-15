# BrasOS

A Linux-based OS whose entire UI is React/TypeScript. Linux kernel + NixOS userspace; Bun runs the system services; Chromium (kiosk, under `cage`) renders the shell for now. Goal: performance first, every app isolated, every app and the shell itself user-customizable, and any Linux app runnable. Apps are PWAs (Web App Manifests). Details of the long-term plan are in "Roadmap" below.

## Layout: vertical slices

The repo is organized by what BrasOS does, not by technical layer. Each slice owns everything it needs: server code, UI, NixOS module, tests (`test/`) and benchmarks (`bench.ts`).

| Path | What | Notes |
|---|---|---|
| `packages/host/` | Composition root: serves every origin, the **one capability gate**, static serving, build. Knows no feature itself | Security boundary. Read "Contracts" before changing. `module.nix` defines `brasos.src` |
| `packages/shell/` | React desktop: windows, taskbar (start, search, apps, tray), desktop icons, the agent client. Layout in `shell.css`, user overrides in `user.css` | Windows host apps as iframes; built on `@brasos/ui` |
| `packages/files/` | The user's files: a filesystem confined to one home folder, as routes and agent tools | Read its README before touching it |
| `packages/docs/` | The OS's guides: markdown in `docs/guide/`, rendered by Bun's built-in renderer | `/os/docs*` routes |
| `packages/setup/` | First boot: the initial account and preferences, the lock screen's login, unattended preseed | Allowed in hardened (`setup.write`, `setup.login`); read its README |
| `packages/compositor/` | Spike: a smithay compositor (DRM/KMS or nested in cage) that tiles Chromium beside native Wayland apps | Dev only (`brasos.compositor.enable`); read its README for what is missing |
| `packages/native/` | Native (non-PWA) windows in the shell: list, focus, close through the compositor's control socket | Gated `native.read`/`native.control` (shell only, denied by hardened); read its README |
| `packages/system/` | Restart the interface: `POST /os/system/restart` and the `system_restart` agent tool, gated by `system.restart` | Only where a supervisor can restart the host (`BRASOS_RESTART_CMD`) |
| `packages/agent/` | The agent interface: an MCP endpoint, token auth, and a relay to the shell's UI tools | Denied entirely by the hardened package |
| `packages/ui/` | `@brasos/ui`: the basic components (button, field, toolbar, breadcrumb, list, icon tile, menu, dialog, window frame, taskbar, search field, tray) and the design tokens | Used by the shell and apps |
| `packages/registry/` | The app list: built-in apps and installed PWAs, both described by a Web App Manifest | `/os/apps*` routes |
| `packages/web-gateway/` | Loads websites through the host: per-site origins, SSRF-safe fetching, TypeScript served as JavaScript | Read its README before touching it |
| `packages/sdk/` | `@brasos/sdk`: talk to BrasOS from a page; polyfills outside BrasOS. Every app imports it | Also built as `/__brasos/sdk.js` and injected into websites |
| `packages/audit/` | Tamper-evident audit trail, its verifier, and the journald module | See `docs/audit.md` |
| `packages/hardened/` | The hardened package: server policy (`src/`) and NixOS module (`module.nix`, option `brasos.hardened.enable`) | Hardened pins a dependency hash: update it when `bun.lock` changes |
| `packages/devtools/` | Dev conveniences as a NixOS module (`brasos.devtools.enable`, on unless hardened is) | Insecure by design |
| `apps/<id>/` | One app: `manifest.webmanifest`, `index.html`, `main.ts`, optional `server.ts` (its server-side slice) | `import "@brasos/sdk"` |
| `apps/terminal/`, `apps/browser/`, `apps/files/`, `apps/docs/`, `apps/about/`, `apps/crash-test/` | The built-in apps | `terminal`, `browser` and `files` hold capabilities; `docs` and `about` ship in hardened |
| `docs/guide/` | The user and developer guides shown in the Docs app (numbered markdown files) | Keep them true: a test checks every cross-link |
| `nixos/base.nix` | OS image pieces every system shares: kiosk session, fonts, VM settings | |
| `flake.nix` | One system per profile: `brasos-dev`, `brasos-hardened` | `flake.lock` pins nixpkgs: commit it |
| `tools/bench.ts` | Benchmark runner: discovers every slice's `bench.ts` | |
| `tools/storybook/` | Storybook for the UI kit and the apps (`bun run storybook`), on the SDK polyfills; its own dependencies | Not in the image; see its README |
| `scripts/vm/` | Build, boot and drive the test VM | |

Modules import each other through the aliases in `tsconfig.json` (`@brasos/audit`, `@brasos/sdk`, `@brasos/host/*`, ...). There is no workspace install: one root `package.json`, one `bun.lock`.

### Adding a feature
1. Make or extend a slice. Server routes go in the slice's `Slice.handle`; an app contributes server code with `apps/<id>/server.ts` exporting `createSlice({ audit })`.
2. Privileged routes call `ctx.gate("capability.name")`; declare the permission in the apps' manifests that may use it.
3. Tests next to the code (`bun test`), including the refused case with and without the hardened package. A benchmark in the slice's `bench.ts`.
4. Docs in the slice's `README.md`; new contracts here.

## Contracts (do not break without updating this file and the tests)

1. **One origin per app.** App `<id>` is served at `http://<id>.localhost:<port>`; the shell is `http://localhost:<port>`; a website loaded through the gateway is `http://<32 hex>.web.localhost:<port>`. A restarted window uses `<id>--<n>.localhost` (fresh origin, so a fresh process). The host derives the target from the Host header.
2. **One capability gate, server-side.** `ctx.gate(cap)` identifies the caller from the browser-set `Origin` header (a same-origin GET carries `Sec-Fetch-Site` instead), requires the permission in the caller's manifest (the shell has a fixed set), requires every enabled package's policy to allow it, and audits the decision, allow and deny. A request with no identifiable caller is refused. Never gate in client code. Websites loaded through the gateway never hold capabilities.
3. **The host binds to `127.0.0.1` and rejects any Host that is not `localhost` or `*.localhost`.** The terminal is full user access; do not widen this.
4. **Heartbeat.** The shell sends `"ping"` via `postMessage`; windows answer `"pong"` (importing `@brasos/sdk` does it). No pong for 8 s = the shell shows "isn't responding" with Restart/Close. A hung app must never affect the shell.
5. **Window chrome is wrapped in an error boundary;** a throwing window must not take down the shell.
6. **Apps are PWAs.** An app is a Web App Manifest plus an optional `brasos` block (`icon`, `permissions`, `hardened`). Installed PWAs get **no** permissions: a remote manifest can't grant itself any. In the hardened package an app is available only if its manifest says `"brasos": { "hardened": true }` (default deny), at server level and in the Nix image.
7. **All web access goes through the gateway.** The only code that fetches a user-supplied URL is `gateway.fetchPublic`, which refuses loopback/private/link-local/metadata addresses, bounds time and size, and re-checks redirects. Don't `fetch()` such URLs anywhere else.
8. **Packages are enabled by name** (`BRASOS_PACKAGES=hardened`; NixOS `brasos.hardened.enable`). A package's policy can only restrict (every enabled policy must allow). An unknown name is an error, never ignored.
9. **Every privileged decision is audited** through `audit()` in `packages/audit` (hash-chained, see `docs/audit.md`). Never record security decisions with `console.log`. A new capability ships with audit events and tests for both outcomes.
10. **Files stay inside the home.** Every path is virtual and absolute (`/Desktop/x`); `..` collapses at the root, symlinks that lead outside are refused (also for existing files being overwritten), deleting moves to `/.trash`. The `fs.read`/`fs.write` capabilities cover the whole home (scoping per app is future work).
11. **Agents are authenticated and never browsers.** `/mcp` needs the bearer token from `agent.token` in the state dir, refuses any request with an `Origin` header, requires the `agent.call` capability, checks every tool's capability against the agent's allow-list and the enabled packages, audits calls, and **never writes tool arguments to the trail**. The hardened package denies `agent.call`, `ui.host`, `ui.control`, `system.*` and `fs.*`.
12. **Dev only:** the live OS copy is user-editable at `/var/lib/brasos/state/home/BrasOS` (so `/BrasOS` in Files, writable through `fs.write`); restarting it is the `system.restart` capability (shell, agents, apps that declare it; denied by hardened, and only available when `BRASOS_RESTART_CMD` is set); if it fails 3 times in 60 s, systemd starts the pristine copy (`brasos-shell-safe`), and `brasos-reset-shell` re-seeds. Claude Code has full privilege by design (user `brasos`: default password, passwordless sudo). The hardened package has no terminal, no agent, no sudo, no usable login and an immutable shell.

13. **First boot.** Until `<state>/setup.json` exists the shell shows the installer. The account is stored as an argon2id hash only (mode 0600, atomic write), the password never reaches the audit trail or an error message, `setup.write`/`setup.login` belong to the shell alone (apps and agents never get them), setup completes once, login is throttled and audited, and the lock screen is **not** access control (say so wherever it is described). A preseed accepts a hash, never a password. `BRASOS_SETUP_DEV_SKIP=1` / `brasos.setup.devSkip` is a dev-only shortcut (no installer, no lock screen, a throwaway account): the host ignores it when any package is enabled and the hardened module refuses to build with it.

14. **Native windows.** A native app's windows belong to the compositor; the shell reaches them only through `packages/native` (`native.read`, `native.control`, both shell-only; no app, agent or hardened profile holds them), over a 0600 Unix socket, with the window id validated and every focus/close audited (never titles). A native app is a full user process with no sandbox yet: it must not ship in hardened.

## Commands

```bash
bun install && bun run dev                  # OS shell at http://localhost:7000 (works on Windows/macOS/Linux)
bun test                                    # every slice's tests, ~3 s
bun run storybook                           # UI kit and apps in a browser at :6006, no VM or host (SDK polyfills)
bun run bench [--out f.json] [--compare baseline.json]   # benchmarks; --compare exits 1 on >25% p50 regression
BRASOS_PACKAGES=hardened bun run dev        # run the server with the hardened policy
journalctl -u brasos-shell -o cat | grep '^AUDIT' | bun packages/audit/src/verify.ts   # verify the audit trail
cat .state/agent.token                      # the MCP bearer token for local dev (the dev image: /var/lib/brasos/state/agent.token)
scripts/vm/build.sh                         # build the NixOS VM (Linux/WSL, clone inside WSL's own fs); PROFILE=hardened for the other one
scripts/vm/run.sh                           # boot it from a clean disk; keep it running (PROFILE=dev|hardened)
scripts/vm/ctl.py shot out.png              # screenshot the VM (from repo root)
scripts/vm/ctl.py key tab tab ret           # keyboard into the VM (the pointer can't be driven)
scripts/vm/ctl.py type "whoami"             # type into the focused terminal
```

WSL2 specifics (already handled in the config, listed so you don't re-debug): QEMU's GL display crashes under WSLg, virtiofs fails, so the VM uses a plain display and a baked store image; your user must be in the `kvm` group; the VM dies when the launching WSL session exits.

## Definition of done

- `bun test` passes.
- Touching `nixos/`, `packages/*/module.nix` or `flake.nix`: `scripts/vm/build.sh` succeeds for **both** profiles, and for anything user-visible, boot it and look (`ctl.py shot`).
- Touching UI: tweak it in Storybook (`bun run storybook`, add a story for a new component or app), then use the feature in a browser at `http://localhost:7000`; type checks passing is not evidence it works.
- Anything new that runs code ships with a benchmark (see below).
- A new contract, capability or convention gets written here in the same commit.

## Benchmarking (requirement: every part is measurable)

`tools/bench.ts` starts a host and runs every slice's `bench.ts` (default export of type `Bench`, see `tools/bench-types.ts`). Each bench records `{name, unit, samples[]}`; the runner prints n/p50/p95/max, writes JSON with `--out`, and fails on regressions with `--compare`. Naming: `<component>.<metric>`. Today: `host.*`, `registry.list`, `gateway.*`, `files.*`, `docs.*`, `agent.*`, `ui.render_*`, `audit.emit`, `terminal.keystroke_echo`. Measure latency distributions (p95/max), not just averages. Numbers are comparable only on the same machine and platform, so keep baselines per platform and don't commit one from a laptop as "truth".

Not yet measured (open work): window open time and frame time in Chromium, per-app RSS and cold start, boot time to shell-ready in the VM (`systemd-analyze`), input-to-photon latency, build time. VM-level benches belong in `scripts/vm/` and should use `ctl.py`.

## Profiles and packages

A profile is a flake output; the packages decide what it contains.

- **dev** (`brasos-dev`): `brasos.hardened.enable = false`, so `brasos.devtools` is on. Everything convenient and deliberately insecure; the taskbar tray shows "DEV · not secure" ("Hardened" in the other profile); the original text was "DEV · hardened package off · not secure" so nobody mistakes it.
- **hardened** (`brasos-hardened`): `brasos.hardened.enable = true` (sets `BRASOS_PACKAGES=hardened`). Work in progress toward the requirements below. Today it has: no credentials and no sudo (locked `nologin` user), no terminal, browser or dev apps, no web gateway and no app installing (capabilities denied), dependencies fetched at build time and pinned by hash (nothing fetched at boot), everything bundled at build time and run from the immutable store, a sandboxed service (throwaway user, read-only filesystem, no capabilities, syscall filter, loopback-only), a kiosk browser policy (only the local shell, no devtools, extensions or sync), kernel sysctl hardening, no default packages. It has been booted in the VM; it has not been audited or penetration-tested, and it still lacks encryption, secure boot, signed updates and an admin/MFA story.

## Security posture (requirement: government-grade)

**Current status: the hardened package is a start, not a finished or certified system. The dev profile is not secure.** Do not describe either as secure or compliant anywhere. Target jurisdiction: **Brazil** (federal/state government computers). Nothing here is certified or audited; the threat model is still an open decision.

### Brazilian regime (from web search, Nov 2026; confirm with the customer's security officer and legal before relying on any of it)

- **PPSI** (Programa de Privacidade e Segurança da Informação, SGD/MGI): original Portaria SGD/MGI nº 852/2023, now **PPSI 2.0 via Portaria SGD/MGI nº 9.511 of 28 Oct 2025**, for federal bodies in SISP. The framework guide (v1.2, 30 Jan 2026, read in full) adopts CIS Controls v8.1 entirely for security (controls 1–18, 153 measures), plus Control 0 (governance) and controls 19–25 (privacy/LGPD). Measures are questions an agency answers about itself, so BrasOS supports them rather than "being compliant".
- **GSI/PR** norms: PNSI is **Decreto nº 12.572/2025** (the PPSI guide cites it as the current reference), IN GSI/PR nº 1/2020 (each body must have a security policy, POSIN), nº 3/2021 (mandatory security-management processes), nº 5/2021 (minimum requirements for cloud), and nº 9/2026 (added to the PPSI guide's reference norms; not read).
- **ICP-Brasil** (ITI): if the OS signs or handles digital certificates, DOC-ICP-10 and the Manuais de Condutas Técnicas (MCT 5 authentication software, MCT 7 cryptographic modules) apply and require homologation.
- **LGPD** (Lei 13.709/2018) for personal data, and a separate regime for classified information. Not researched here.
- No mandatory national OS certification scheme was found. Common Criteria and NIST SP 800 appear as international references. Whether the customer demands a certification is a question for them, not an assumption for us.

The hardened-package requirements are mapped to PPSI measures in [`docs/compliance/ppsi-mapping.md`](docs/compliance/ppsi-mapping.md) (R1–R24, with status and open questions). Keep it current: a change that adds, removes or satisfies a requirement updates its row in the same commit. The guide is CC BY-NC-ND: cite measure numbers and use our own words, never paste its text.

Dev-only conveniences that the hardened package must not have: user `brasos` with a default password and passwordless sudo; Claude Code with full privilege; `bun install` from the network at boot; a user-editable OS copy that runs unreviewed code; a terminal with full-access PTY; the web gateway (an outbound-network chokepoint that needs its own allowlist policy first).

Rules for all work:
- Default deny. Every privileged capability goes through the host's gate, and has a negative test (refusal must be tested, not just success), with and without the hardened package.
- No new network listeners beyond loopback; no runtime fetching of code or dependencies in anything meant for the hardened package. Dependencies must be pinned and reviewable (Nix closure, lockfiles). Treat each new dependency as supply-chain risk and justify it.
- No secrets, keys or credentials in the repo or the image.
- Every privileged action is recorded through the audit trail (contract 9); don't add side channels.
- Prefer separation by process and by OS mechanisms (users, namespaces, Landlock, seccomp, MAC) over in-process checks.

Hardened-package work (open): reproducible builds + SBOM, secure/measured boot (TPM), full-disk encryption, signed updates with rollback, mandatory access control for services, removal of the dev conveniences above, a web allowlist policy so the gateway can be enabled safely, and a decision on what privilege an AI agent (Claude Code) gets on such a system.

## Working in parallel

- One git worktree per agent: `git worktree add ../brasos-<topic> -b agent/<topic>`. Branch from `main`; rebase on `main` before merging; keep commits small and focused.
- Stay inside your slice (table above). Shared files (`packages/host/src/host.ts`, `packages/host/src/types.ts`, `tsconfig.json`, `flake.nix`, this file) are the merge-conflict hotspots: keep those diffs minimal and mention them in the commit message.
- Don't reformat or reorganize code you aren't changing.
- `.vm/` is per worktree (disk + monitor socket), so several VMs can run side by side; each needs ~4 GB RAM.

## Roadmap (independent areas agents can pick up)

1. **Compositor + native Linux apps** (spike started, see `packages/compositor`): replace `cage` with a Rust smithay compositor (XWayland), Chromium as one client, native app windows composed beside it; Flatpak + XDG portals for foreign apps. Largest item.
2. **SDK and capability broker:** notifications and storage next to the existing files API; per-app scoped folders instead of the whole home; user-granted permissions for installed PWAs (today they get none); an OPFS-backed polyfill for `os.fs` outside BrasOS.
   **App-level agent tools:** apps registering their own tools (e.g. `browser_navigate`) through the shell, relayed to MCP; today only the shell's UI tools and the slices' host tools are exposed.
3. **Web gateway:** a per-package allowlist policy so it can run in hardened; WebSocket pass-through; `srcset`/CSS URL rewriting; `.tsx` support (needs an import map); pinning the resolved IP against DNS rebinding.
4. **Window manager:** minimize/maximize, snapping, per-window focus handling, keyboard navigation (the pointer can't be driven in tests, so keyboard parity matters).
5. **Customization:** theme tokens, user component overrides with hot reload, per-user layers (system → user → app), error-safe reload.
6. **Claude Code integration:** decide its permission tier, first-class launcher, auth flow.
7. **Performance:** measure and budget boot time, input latency, idle RAM per app; zygote-style forking of a preloaded Bun runtime; custom renderer replacing Chromium later.

## Known gaps

- Pointer input can't be driven in the VM test harness (use keyboard).
- No GPU in the VM yet (software rendering); native Linux hosts can switch the QEMU options to `virtio-vga-gl` (see comment in `nixos/base.nix`).
- Process separation per app is by design (distinct origins under Chromium site isolation) but not yet verified with `chrome://process-internals`.
- Apps are rebuilt only when the server restarts.
- A PWA installed through the gateway runs on a gateway origin, not its real one: OAuth redirects, WebAuthn, push notifications and anything that checks the real origin won't work. Restarting a hung PWA window reuses its origin (and so its process).
- Safe-mode fallback is tested only by reasoning plus one partial VM run.
- WebMCP is a draft whose API has moved (`navigator.modelContext` to `document.modelContext`); the SDK adapter is best-effort and unverified against a real WebMCP browser. MCP over HTTP is the dependable path.
- The Files app previews text and small images only; there is no copy/paste, drag and drop, or opening a file in another app.
