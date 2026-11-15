# devtools

Development conveniences as a NixOS module (`brasos.devtools.enable`, on unless `brasos.hardened.enable` is). **Insecure by design.**

- User `brasos` with a default password and passwordless sudo, so Claude Code (installed) has full privilege.
- `bun install` at boot, and a user-editable copy of the OS in the user's home, `/BrasOS` in Files (`/var/lib/brasos/state/home/BrasOS`, seeded from the repo on first boot). `BRASOS_RESTART_CMD` points at a script that restarts `brasos-shell` (the shell's *Restart interface* button and the `system_restart` agent tool use it; it resets the failure counter, so a deliberate restart never trips safe mode). If it fails three times in a minute, systemd starts the pristine copy from the Nix store (`brasos-shell-safe`); the shell page reloads itself when the server comes back. `brasos-reset-shell` re-seeds the live copy.
- State lives in `/var/lib/brasos/state`: installed PWAs, the user's home (`home/`, with `/Desktop`, `/Documents`, `/Downloads`), the gateway key, and the **agent token** (`agent.token`, readable only by `brasos`) for connecting an MCP client such as Claude Code.
- The terminal app is not part of this module (it is a normal app), but the hardened package refuses it.

Nothing here may leak into the hardened package: the two are mutually exclusive (asserted in the module).
