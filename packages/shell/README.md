# shell

The React desktop: icons for every app and for the files in `/Desktop`, a taskbar, draggable windows, and one iframe per app (or per website for PWAs). Built on `@brasos/ui`.

- **Isolation**: each window is an iframe on its own origin, so Chromium puts it in its own process. A heartbeat (`ping`/`pong` through `@brasos/sdk`) detects a hung app; the shell stays responsive and offers Restart (a fresh origin, so a fresh process). Each window sits in an error boundary.
- **Apps**: lists `/os/apps`. A PWA window asks the host for its gateway URL (`/os/web/open`) first.
- **Messages from windows**: `apps-changed` (refetch the list) and `open` (an app asked, through `os.apps.open`, to open another; the shell checks the `apps.open` permission itself because it is UI-only).
- **Desktop**: an icon per app, then the `/Desktop` folder's entries (refreshed every few seconds and when an app reports a file change). Enter or double-click opens: apps open; folders and files open in Files at that place. Right-click for *Open Files* / *Refresh*.
- **Agent interface**: `src/agent.ts` offers `ui_snapshot`, `windows_focus`, `windows_close` and `apps_open` to AI agents (over a WebSocket the host relays MCP calls through) and to WebMCP when the browser has it. Not attempted in the hardened package.
- **Self-healing**: if the server restarts or fails over (dev's safe copy), the page reloads itself.
- **Customization**: colors and radii are CSS variables in `src/shell.css`; put overrides in `src/user.css`.
- **Taskbar**: Start (all apps) and a search box on the left, a button per app (a bar under it when it has a window, a longer colored one when its window is focused; clicking focuses or opens), and the tray on the right: security mode, network, battery (hidden on a computer without one) and the clock; Lock, Edit/New app/Reload/Restart interface, Restart and Shut down are in the Start menu. The search box (or Ctrl+K) searches apps, open windows, files in `/Desktop`, `/Documents` and `/Downloads` (needs `fs.read`; absent in hardened) and the guides (`docs.read`).
- **Tray panels**: the clock opens a calendar (`calendar.ts`: month grid, ISO week numbers, the preferences' time zone with its UTC offset); the network icon opens the connection details and the Wi-Fi list from `packages/network` (`/os/network`), where a network can be joined or left. Both close on Escape, a press outside, or the page losing focus.
- **Marker**: the tray shows "DEV · not secure" unless the hardened package is on, when it shows "Hardened".

The shell holds a fixed set of capabilities (`apps.read`, `apps.uninstall`, `web.open`, `fs.read`, `docs.read`, `ui.host`, `system.restart`); see `packages/host/src/host.ts`.
