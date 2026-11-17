# recovery

The page the kiosk shows when the desktop's server (port 7000) stops answering, with tools to bring it back: restart the desktop,
start the safe (original) copy, start a clean copy, show the latest log, restart the computer. It polls the desktop and the kiosk
returns to it by itself when it is up.

- A **separate service** (`brasos-recovery`, loopback port 7001), run from the pristine copy in the Nix store, so an edited or broken desktop can't take it down.
- **The kiosk switches to it** (`brasos-ui` in `nixos/base.nix`): the desktop unreachable for about 12 s, or not up 40 s after boot, restarts Chromium on this page; when the desktop answers again, back to the desktop. Only where the image sets `brasos.recoveryUrl`.
- **Actions** are the fixed names in `ACTIONS`; the commands come from `BRASOS_RECOVERY_ACTIONS` (set by the image), never from a request. A POST needs `Origin: http://localhost:7001` (this page alone); Host must be localhost. Every action, allowed or refused, is audited (event `recovery.action`; never the command output).
- **Dev profile only.** The actions need sudo, which the hardened package does not have; hardened sets no `recoveryUrl`, so nothing changes there (default deny).
- Not covered: a crashed compositor or Chromium (systemd restarts those), and a PC whose network or kernel is broken.
