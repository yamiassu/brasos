# native

Native (non-PWA) windows in the shell. The compositor (`packages/compositor`) owns them; this slice is the shell's way to **list, focus and close** them, over the compositor's control socket (`BRASOS_COMP_SOCKET`, a 0600 Unix socket; one JSON object per line).

- `GET /os/native` (gate `native.read`): `{ available, windows: [{ id, title, app, focused }] }`. No socket or a dead one means `available: false`, not an error. Only those four fields pass through.
- `POST /os/native/focus` and `/os/native/close` with `{ id }` (gate `native.control`, same-origin): `id` is checked as a positive integer; the compositor ignores ids of windows that do not exist. Audited as `native.focus` / `native.close` (the id, never a title).
- **Who may**: the shell holds both capabilities. No installed app or agent can have them, and the **hardened package denies both** (it has no native apps).
- This is the control path only: a native app is still a full user process; sandboxing it is not done (see the compositor README).
