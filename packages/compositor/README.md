# compositor (spike)

Roadmap item 1, first step: a Wayland compositor built on [smithay](https://github.com/Smithay/smithay) that shows **Chromium (the shell) beside native Linux apps**. Today `cage` shows exactly one client, so a non-PWA app has nowhere to appear.

## What exists

- `brasos-comp`: smithay's `smallvil` example (MIT, see `LICENSE-smithay.txt`, pinned to commit `fd8e3f5`) with two changes: every `-c "<command>"` starts one client, and windows are tiled side by side in equal columns.
- Two backends. **DRM/KMS** (`src/drm.rs`, `--drm` or `BRASOS_BACKEND=drm`): it owns the display (dumb buffers scanned out, composited with pixman), keyboard and pointer (libinput) and the seat (libseat/logind), with VT-switch pause/resume. **winit** (default): a nested window, for running inside another compositor.
- `module.nix`: `brasos.compositor.enable` (dev only; asserts the hardened package is off) swaps the session to `brasos-comp -c <chromium> -c foot` inside cage (flake output `brasos-dev-comp`); adding `brasos.compositor.drm` replaces cage itself (`brasos-dev-drm`; it reuses cage's tty/PAM/logind unit with a `cage` that starts `brasos-comp --drm`). `brasos.compositor.clients` lists the native apps.
- `src/ctl.rs`: a control socket (`BRASOS_COMP_SOCKET`) that streams the window list and accepts `focus`/`close`; `packages/native` exposes it to the shell, which shows a taskbar button per native window (click focuses, right-click closes).
- Fullscreen requests are honored as the *state* (so Chromium hides its tab strip) while keeping the tile.
- Verified in the VM (`PROFILE=dev-comp` and `PROFILE=dev-drm`): `foot` (a native Wayland terminal) left of Chromium, installer completed by keyboard, no `cage` process in the DRM image.

## Not done (in order)

1. **DRM, the rest**: no hardware cursor or drawn pointer yet (the pointer moves but is invisible), no monitor hotplug or multi-output, and the software path only. The GPU path (GBM + EGL + `GlesRenderer`, dmabuf, direct scanout; see smithay's `anvil`) changes the allocator and renderer, not the structure. Not run on real hardware.
2. **Native windows in the shell, the rest**: taskbar buttons work (verified in the VM through `/os/native`), but the shell does not draw native window frames or place them (the compositor still tiles), and on a 640x480 screen the half-width shell hides the taskbar's right side.
3. **Foreign apps**: XWayland for X11 apps, Flatpak plus XDG desktop portals for packaging and permissions, and a manifest (`brasos` block) for a native app so the registry and launcher list it.
4. **Security**: a native app is a full user process, not an isolated origin. Needs its own sandbox (Flatpak/bubblewrap, Landlock) and capability gate before it can ship anywhere near the hardened package. Wayland clients can also be denied protocols (screencopy, virtual input) per client.
5. A benchmark (frame time, input latency, spawn-to-first-frame): the DRM backend now makes it meaningful; it belongs in `scripts/vm/` since it needs the VM.

## Build

`package.nix` builds it from `Cargo.lock`; the one git dependency (smithay) needs its hash in `outputHashes`, so **update it when `rev` or `Cargo.lock` changes** (build with `lib.fakeHash` and copy the hash from the error).
