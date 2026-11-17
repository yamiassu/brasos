# native

Native (non-PWA) windows in the shell. The compositor (`packages/compositor`) owns them; this slice is the shell's way to **list, focus and close** them, over the compositor's control socket (`BRASOS_COMP_SOCKET`, a 0600 Unix socket; one JSON object per line).

- `GET /os/native` (gate `native.read`): `{ available, windows: [{ id, title, app, focused }] }`. No socket or a dead one means `available: false`, not an error. Only those four fields pass through.
- `POST /os/native/focus` and `/os/native/close` with `{ id }` (gate `native.control`, same-origin): `id` is checked as a positive integer; the compositor ignores ids of windows that do not exist. Audited as `native.focus` / `native.close` (the id, never a title).
- **Who may**: the shell holds both capabilities. No installed app or agent can have them, and the **hardened package denies both** (it has no native apps).
- `POST /os/native/place` `{ id, x, y, w, h }` (integers in range; `native.control`, same-origin): the shell tells the compositor where a window's content goes, because the shell draws the frame. A drag sends many, so allows are throttled in the trail like quiet reads (denials never are). The list also carries each window's size (`w`, `h`).
- This is the control path only. A native app is launched by id from the image's list; unless the image marks it `open` (Steam), it runs in bubblewrap. Open apps are full user processes (see the compositor README).
