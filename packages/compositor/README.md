# compositor (spike)

Roadmap item 1, first step: a Wayland compositor built on [smithay](https://github.com/Smithay/smithay) that shows **Chromium (the shell) beside native Linux apps**. Today `cage` shows exactly one client, so a non-PWA app has nowhere to appear.

## What exists

- `brasos-comp`: smithay's `smallvil` example (MIT, see `LICENSE-smithay.txt`, pinned to commit `fd8e3f5`) with two changes: every `-c "<command>"` starts one client, and windows are tiled side by side in equal columns.
- Two backends. **DRM/KMS** (`src/drm.rs`, `--drm` or `BRASOS_BACKEND=drm`): it owns the display (dumb buffers scanned out, composited with pixman), keyboard and pointer (libinput) and the seat (libseat/logind), with VT-switch pause/resume. **winit** (default): a nested window, for running inside another compositor.
- `module.nix`: `brasos.compositor.enable` (dev only; asserts the hardened package is off) swaps the session to `brasos-comp -c <chromium> -c foot` inside cage (flake output `brasos-dev-comp`); adding `brasos.compositor.drm` replaces cage itself (`brasos-dev-drm`; it reuses cage's tty/PAM/logind unit with a `cage` that starts `brasos-comp --drm`). `brasos.compositor.clients` lists the native apps.
- `src/ctl.rs`: a control socket (`BRASOS_COMP_SOCKET`) that streams the window list (with sizes) and accepts `focus`, `close`, `launch` and `place`; `packages/native` exposes it to the shell. **The shell is the window manager**: Chromium fills the screen at the bottom, every native window floats above it, and the shell draws each one's frame (title bar, close, move, resize, `packages/shell/src/native.tsx`) and sends `place` (the content rectangle) so the app sits inside it. There is also a taskbar button per native window (click focuses, right-click closes). Alt+Tab cycles keyboard focus.
- Fullscreen requests are honored as the *state* (so Chromium hides its tab strip). There is no tiling any more.
- Verified in the VM (`PROFILE=dev-comp` and `PROFILE=dev-drm`): `foot` (a native Wayland terminal) left of Chromium, installer completed by keyboard, no `cage` process in the DRM image.

- **Native apps**: `brasos.compositor.apps.<id>` lists what the launcher offers. `sandbox = "strict"` (default) runs it in bubblewrap with an empty home; `sandbox = "open"` runs it as a plain user process for apps that cannot be confined (Steam). Each app's stdout/stderr go to `/run/brasos-comp/<id>.log` (readable only by the session user): look there first when a window does not appear.
- **X11 apps**: `brasos.compositor.xwayland = true` starts Xwayland (smithay's xwayland feature and an X11 window manager in `src/handlers/xwayland.rs`); X11 windows float like Wayland ones (the shell places them), menus and tooltips (override-redirect) place themselves, and the shell lists them (title and class). The X11/Wayland clipboard is not bridged yet. Xwayland's log is `/run/brasos-comp/xwayland.log`.
- **Steam**: `brasos.steam.enable` (flake output `brasos-dev-steam`; `steam.nix`) adds an unfree Steam, 32-bit graphics, Xwayland and a `steam` launcher entry. The Steam client downloads itself on first launch; its account and games live in the user's home. It needs the network and, for anything beyond the client UI, a GPU (the VM has none, so expect a slow, software-rendered client). It must never ship in hardened (the module asserts it).

## Not done (in order)

1. **DRM, the rest**: no hardware cursor or drawn pointer yet (the pointer moves but is invisible), no monitor hotplug or multi-output, and the software path only. The GPU path (GBM + EGL + `GlesRenderer`, dmabuf, direct scanout; see smithay's `anvil`) changes the allocator and renderer, not the structure. Not run on real hardware.
2. **Native windows in the shell, the rest**: native windows are always drawn above everything the shell shows (launcher, menus, dialogs and PWA windows can't cover them: they are separate surfaces), and the shell clamps them above the taskbar. No minimize/maximize/snap, no per-window icon (the generic one is shown), and the frame position is polled (about 0.5 s) so a new window sits at its default place for an instant.
3. **Foreign apps**: Flatpak plus XDG desktop portals for packaging and permissions, and a manifest (`brasos` block) for a native app so the registry and launcher list it.
4. **Security**: a native app is a full user process, not an isolated origin. Needs its own sandbox (Flatpak/bubblewrap, Landlock) and capability gate before it can ship anywhere near the hardened package. Wayland clients can also be denied protocols (screencopy, virtual input) per client.
5. A benchmark (frame time, input latency, spawn-to-first-frame): the DRM backend now makes it meaningful; it belongs in `scripts/vm/` since it needs the VM.

## Build

`package.nix` builds it from `Cargo.lock`; the one git dependency (smithay) needs its hash in `outputHashes`, so **update it when `rev` or `Cargo.lock` changes** (build with `lib.fakeHash` and copy the hash from the error).
