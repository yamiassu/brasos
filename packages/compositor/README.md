# compositor (spike)

Roadmap item 1, first step: a Wayland compositor built on [smithay](https://github.com/Smithay/smithay) that shows **Chromium (the shell) beside native Linux apps**. Today `cage` shows exactly one client, so a non-PWA app has nowhere to appear.

## What exists

- `brasos-comp`: smithay's `smallvil` example (MIT, see `LICENSE-smithay.txt`, pinned to commit `fd8e3f5`) with two changes: every `-c "<command>"` starts one client, and windows are tiled side by side in equal columns.
- It uses smithay's **winit backend**, so it runs *inside* `cage` as that kiosk's single client and hosts the others. That is a stand-in: it costs an extra compositing hop and does not own the display, input devices or the session.
- `module.nix`: `brasos.compositor.enable` (dev only; asserts the hardened package is off) swaps the session to `brasos-comp -c <chromium> -c foot`; `brasos.compositor.clients` lists the native apps. Flake output `brasos-dev-comp`.
- Verified in the VM: `PROFILE=dev-comp scripts/vm/run.sh` shows `foot` (a native Wayland terminal) left of Chromium.

## Not done (in order)

1. **Own the display**: replace cage with the DRM/KMS backend (`backend_drm`, `backend_libinput`, `backend_session_libseat`, `backend_gbm`; see smithay's `anvil` for the udev backend). Then `brasos-comp` is the session.
2. **Native windows in the shell**: the shell (React) draws window frames, taskbar entries and the launcher; the compositor should place native windows into the shell's layout over a local protocol, not tile them itself. Until then native apps have no frame, taskbar button, heartbeat or permission story.
3. **Kiosk Chromium**: it shows its tab strip because the compositor ignores fullscreen requests; honor `xdg_toplevel.set_fullscreen`.
4. **Foreign apps**: XWayland for X11 apps, Flatpak plus XDG desktop portals for packaging and permissions, and a manifest (`brasos` block) for a native app so the registry lists it.
5. **Security**: a native app is a full user process, not an isolated origin. Needs its own sandbox (Flatpak/bubblewrap, Landlock) and capability gate before it can ship anywhere near the hardened package. Wayland clients can also be denied protocols (screencopy, virtual input) per client.
6. A benchmark (frame time, input latency, spawn-to-first-frame) once the DRM backend exists; the winit stand-in would measure the wrong thing.

## Build

`package.nix` builds it from `Cargo.lock`; the one git dependency (smithay) needs its hash in `outputHashes`, so **update it when `rev` or `Cargo.lock` changes** (build with `lib.fakeHash` and copy the hash from the error).
