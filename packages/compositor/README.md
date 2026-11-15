# compositor (spike)

Roadmap item 1, first step: a Wayland compositor built on [smithay](https://github.com/Smithay/smithay) that shows **Chromium (the shell) beside native Linux apps**. Today `cage` shows exactly one client, so a non-PWA app has nowhere to appear.

## What exists

- `brasos-comp`: smithay's `smallvil` example (MIT, see `LICENSE-smithay.txt`, pinned to commit `fd8e3f5`) with two changes: every `-c "<command>"` starts one client, and windows are tiled side by side in equal columns.
- It uses smithay's **winit backend**, so it runs *inside* `cage` as that kiosk's single client and hosts the others. That is a stand-in: it costs an extra compositing hop and does not own the display, input devices or the session.
- `module.nix`: `brasos.compositor.enable` (dev only; asserts the hardened package is off) swaps the session to `brasos-comp -c <chromium> -c foot`; `brasos.compositor.clients` lists the native apps. Flake output `brasos-dev-comp`.
- `src/ctl.rs`: a control socket (`BRASOS_COMP_SOCKET`) that streams the window list and accepts `focus`/`close`; `packages/native` exposes it to the shell, which shows a taskbar button per native window (click focuses, right-click closes).
- Fullscreen requests are honored as the *state* (so Chromium hides its tab strip) while keeping the tile.
- Verified in the VM: `PROFILE=dev-comp scripts/vm/run.sh` shows `foot` (a native Wayland terminal) left of Chromium.

## Not done (in order)

1. **Own the display**: replace cage with the DRM/KMS backend (`backend_drm`, `backend_libinput`, `backend_session_libseat`, `backend_gbm`; see smithay's `anvil` udev backend, ~1700 lines to adapt). Then `brasos-comp` is the session and the extra compositing hop goes away.
2. **Native windows in the shell, the rest**: taskbar buttons work (verified in the VM through `/os/native`), but the shell does not draw native window frames or place them (the compositor still tiles), and on a 640x480 screen the half-width shell hides the taskbar's right side.
3. **Foreign apps**: XWayland for X11 apps, Flatpak plus XDG desktop portals for packaging and permissions, and a manifest (`brasos` block) for a native app so the registry and launcher list it.
4. **Security**: a native app is a full user process, not an isolated origin. Needs its own sandbox (Flatpak/bubblewrap, Landlock) and capability gate before it can ship anywhere near the hardened package. Wayland clients can also be denied protocols (screencopy, virtual input) per client.
5. A benchmark (frame time, input latency, spawn-to-first-frame) once the DRM backend exists; the winit stand-in would measure the wrong thing.

## Build

`package.nix` builds it from `Cargo.lock`; the one git dependency (smithay) needs its hash in `outputHashes`, so **update it when `rev` or `Cargo.lock` changes** (build with `lib.fakeHash` and copy the hash from the error).
