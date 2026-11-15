# devtools

Development conveniences as a NixOS module (`brasos.devtools.enable`, on unless `brasos.hardened.enable` is). **Insecure by design.**

- User `brasos` with a default password and passwordless sudo, so Claude Code (installed) has full privilege.
- `bun install` at boot, and a user-editable copy of the OS at `/var/lib/brasos/os` (seeded from the repo on first boot). If it fails three times in a minute, systemd starts the pristine copy from the Nix store (`brasos-shell-safe`); the shell page reloads itself when the server comes back. `brasos-reset-shell` re-seeds the live copy.
- Installed PWAs are kept in `/var/lib/brasos/state`.
- The terminal app is not part of this module (it is a normal app), but the hardened package refuses it.

Nothing here may leak into the hardened package: the two are mutually exclusive (asserted in the module).
