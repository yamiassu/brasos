# shell

The React desktop: a dock, draggable windows, and one iframe per app (or per website for PWAs).

- **Isolation**: each window is an iframe on its own origin, so Chromium puts it in its own process. A heartbeat (`ping`/`pong` through `@brasos/sdk`) detects a hung app; the shell stays responsive and offers Restart (a fresh origin, so a fresh process). Each window sits in an error boundary.
- **Apps**: lists `/os/apps`. A PWA window asks the host for its gateway URL (`/os/web/open`) first.
- **Messages from windows**: `apps-changed` (refetch the list) and `open` (an app asked, through `os.apps.open`, to open another; the shell checks the `apps.open` permission itself because it is UI-only).
- **Self-healing**: if the server restarts or fails over (dev's safe copy), the page reloads itself.
- **Customization**: colors and radii are CSS variables in `src/shell.css`; put overrides in `src/user.css`.
- **Marker**: the dock shows "DEV · hardened package off · not secure" unless the hardened package is on.

The shell holds a fixed set of capabilities (`apps.read`, `apps.uninstall`, `web.open`); see `packages/host/src/host.ts`.
