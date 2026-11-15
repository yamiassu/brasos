# Architecture

## Layers

```
Linux kernel (NixOS userspace, glibc)
 └─ systemd
     ├─ brasos-shell.service   Bun server: serves the shell and apps, owns every privileged capability, writes the audit trail
     └─ cage-tty1.service      Wayland kiosk compositor, runs Chromium full-screen on http://localhost:7000
          └─ Chromium
               ├─ shell (React)             http://localhost:7000
               └─ apps, one iframe each     http://<app>.localhost:7000   (own origin => own renderer process)
```

Phase 1 (today) uses Chromium and `cage`. The roadmap (see `AGENTS.md`) replaces `cage` with a Rust compositor so native Linux apps can be composed beside the React UI, and later replaces Chromium with a custom renderer.

## How an app runs

1. The shell fetches `/api/apps` and lists apps in the dock.
2. Opening one creates a window with an `<iframe>` pointing at the app's own origin. Because the origin differs from the shell's, Chromium's site isolation puts it in a separate process: a crash or hang there can't take the shell down.
3. The server derives the app from the `Host` header. A restarted window uses `<app>--<n>.localhost`, a fresh origin and therefore a fresh process (a hung process would otherwise be reused).
4. The shell pings each app with `postMessage`; the app's `sdk.ts` answers `pong`. No pong for 8 seconds shows "isn't responding" with Restart or Close.
5. Privileged capabilities (today: the terminal PTY) are requested over a WebSocket the **server** gates by app id and `Origin`. Every decision, allow or deny, is audited.

## Trust boundaries

| Boundary | Enforced by | Notes |
|---|---|---|
| App ↔ app, app ↔ shell | Browser origin isolation + process isolation | No OS-level sandbox per app yet |
| App/web page → privileged capability | Server: app id + `Origin` check, default deny | Tested for both outcomes in both profiles |
| Network → server | Binds `127.0.0.1`; rejects any `Host` that isn't `localhost`/`*.localhost`; hardened adds a systemd loopback-only IP policy | Blocks DNS rebinding and remote access |
| Service → rest of system | Hardened: throwaway user, read-only filesystem, no capabilities, syscall filter | Dev: runs as the main user |
| Audit trail → service | systemd journal, not writable by the service; hash chain gives tamper evidence | See `docs/audit.md` for limits |

## Profiles

One flake, two systems (`brasos-dev`, `brasos-hardened`), a shared `nixos/base.nix`. The server's `BRASOS_PROFILE` decides what it will serve: apps must list `"hardened"` in their manifest `profiles` to be available there, the PTY is never exposed, and nothing is built at runtime.

### Hardened build pipeline

1. `nodeModules`: a fixed-output derivation runs `bun install --frozen-lockfile` against the pinned `bun.lock` and checks the result against a hash in `hardened.nix`. This is the only step that touches the network, and only at build time. Update the hash when `bun.lock` changes.
2. `dist`: the shell and the opted-in apps are bundled inside the Nix sandbox (`server.ts --build-only`).
3. The service runs `server.ts` from the immutable store with `BRASOS_PREBUILT=1`; it never builds or installs anything.

Apps that aren't opted in are filtered out of the source tree at the Nix level too, so they aren't merely disabled: they aren't in the image.

## Dev conveniences (dev profile only)

The shell is seeded to `/var/lib/brasos/shell` on first boot and is user-editable. If it fails three times in a minute, systemd starts the pristine copy from the Nix store (`brasos-shell-safe`), and the page reloads itself when the server comes back. `brasos-reset-shell` re-seeds.

## Test and benchmark harness

- `shell/scripts/smoke.ts`: boots the server per profile and checks the contracts, including the audit trail and tamper detection.
- `shell/scripts/bench.ts`: per-component latency distributions with a regression gate.
- `scripts/vm/`: build and boot a VM, and drive it through the QEMU monitor (screenshots, key presses). The pointer can't be driven this way, so keyboard navigation matters.
