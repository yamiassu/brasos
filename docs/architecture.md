# Architecture

## Layers

```
Linux kernel (NixOS userspace, glibc)
 └─ systemd
     ├─ brasos-shell.service   Bun host: serves every origin, the capability gate, the slices, the audit trail
     └─ cage-tty1.service      Wayland kiosk compositor, runs Chromium full-screen on http://localhost:7000
          └─ Chromium
               ├─ shell (React)                http://localhost:7000
               ├─ apps, one iframe each        http://<app>.localhost:7000       (own origin => own renderer process)
               └─ websites, via the gateway    http://<32 hex>.web.localhost:7000 (own secure-context origin per site)
```

Phase 1 (today) uses Chromium and `cage`. The roadmap (see `AGENTS.md`) replaces `cage` with a Rust compositor so native Linux apps can be composed beside the React UI, and later replaces Chromium with a custom renderer.

## Vertical slices

The code is organized by what BrasOS does. The host is a thin composition root; each feature is a slice that owns its server code, UI, Nix module, tests and benchmarks.

```
                        ┌──────────── host ─────────────┐
 browser (iframes)  ───►│ origin → target                │
                        │ capability gate (Origin +      │──► audit
                        │   manifest + package policies) │
                        │ slices: registry, web-gateway, │
                        │   apps/<id>/server.ts          │
                        └────────────────────────────────┘
        shell · apps · sdk  (client side)        hardened · devtools  (packages: policy + NixOS module)
```

A slice contributes `{ name, handle?(req, ctx), ws? }`. Built-in slices are listed in `packages/host/src/host.ts`; an app adds its own with `apps/<id>/server.ts` exporting `createSlice({ audit })`, loaded only if the registry (and so every enabled package's policy) admits the app.

## How an app runs

1. The shell fetches `/os/apps` and lists apps in the dock.
2. Opening one creates a window with an `<iframe>` on the app's own origin. Because the origin differs from the shell's, Chromium's site isolation puts it in a separate process: a crash or hang there can't take the shell down.
3. The host derives the target from the `Host` header. A restarted window uses `<app>--<n>.localhost`, a fresh origin and therefore a fresh process.
4. The shell pings each window with `postMessage`; `@brasos/sdk` answers `pong`. No pong for 8 seconds shows "isn't responding" with Restart or Close.
5. Privileged capabilities are routes that call `ctx.gate("name")`. The gate identifies the caller from the browser-set `Origin` header, requires the permission in the caller's manifest and every enabled package's policy to allow it, and audits the decision.

## How a website loads (the browser app)

1. The browser app calls `os.web.open(url)` (permission `web.open`). The gateway validates the URL, registers the site's real origin under an HMAC id, and returns `http://<id>.web.localhost:<port>/path`.
2. The iframe loads that URL. The gateway fetches upstream through `fetchPublic` (address checks, timeouts, size caps), strips framing/CSP headers, rewrites absolute links to gateway URLs, serves `.ts` files as JavaScript, forwards cookies, and injects the SDK.
3. The injected SDK reports the page's real URL and PWA manifest to the browser app, which enables **Install**. Installing stores the manifest in the registry with no permissions; the dock refreshes; opening it later asks the gateway for the start URL again.

## Trust boundaries

| Boundary | Enforced by | Notes |
|---|---|---|
| App ↔ app, app ↔ shell | Browser origin isolation + process isolation | No OS-level sandbox per app yet |
| Page → privileged capability | The host's gate: `Origin`, manifest permission, package policies, audited | Websites on gateway origins never hold capabilities |
| Network → host | Binds `127.0.0.1`; rejects any `Host` that isn't `localhost`/`*.localhost`; hardened adds a systemd loopback-only IP policy | Blocks DNS rebinding and remote access |
| Host → the web | Only `gateway.fetchPublic`: refuses private/loopback/metadata addresses, bounds time and size, re-checks redirects | Off in hardened |
| Service → rest of system | Hardened: throwaway user, read-only filesystem, no capabilities, syscall filter | Dev: runs as the main user |
| Audit trail → service | systemd journal, not writable by the service; hash chain gives tamper evidence | See `docs/audit.md` for limits |

## Packages and profiles

One flake, two systems (`brasos-dev`, `brasos-hardened`), the same modules with `brasos.hardened.enable` off or on; `brasos.devtools` is on unless hardened is, and the two are mutually exclusive. The host's `BRASOS_PACKAGES` selects server-side policy packages; unknown names throw.

### Hardened build pipeline

1. `nodeModules`: a fixed-output derivation runs `bun install --frozen-lockfile` against the pinned `bun.lock` and checks the result against a hash in `packages/hardened/module.nix`. This is the only step that touches the network, and only at build time. Update the hash when `bun.lock` changes.
2. `dist`: the shell and the opted-in apps are bundled inside the Nix sandbox (`main.ts --build-only` with `BRASOS_PACKAGES=hardened`).
3. The service runs the host from the immutable store with `BRASOS_PREBUILT=1`; it never builds or installs anything.

Apps that aren't opted in are filtered out of the source tree at the Nix level too, so they aren't merely disabled: their code isn't in the image, and a slice's `server.ts` is never loaded.

## Dev conveniences (dev profile only)

The OS source is seeded to `/var/lib/brasos/os` on first boot and is user-editable. If it fails three times in a minute, systemd starts the pristine copy from the Nix store (`brasos-shell-safe`), and the page reloads itself when the server comes back. `brasos-reset-shell` re-seeds.

## Test and benchmark harness

- `bun test`: every slice's tests, most against a real host started in-process (`packages/host/src/testing.ts`).
- `bun run bench`: each slice's `bench.ts`, p50/p95/max with a regression gate.
- `scripts/vm/`: build and boot a VM, and drive it through the QEMU monitor (screenshots, key presses). The pointer can't be driven this way, so keyboard navigation matters.
