# Customizing

## Change how it looks

The whole interface is styled with CSS variables (see the [UI kit](06-ui-kit.md)). Put your overrides in `packages/shell/src/user.css`, which loads after everything else:

```css
:root {
  --accent: #ff6b6b;
  --bg: #101010;
  --radius: 4px;
}
```

Restart the server for a change to take effect: `bun run dev` again locally, or `sudo systemctl restart brasos-shell` on the dev image.

Apps load the same tokens, so one change restyles the shell and every app built with the kit.

## Change the desktop

Put files and folders in `/Desktop` (use Files, or save there from an app) and they appear as icons. The desktop checks for changes every few seconds. Right-click it for *Open Files* and *Refresh*.

## Change the interface itself

On the dev image the operating system's own source is a normal folder in your home: **BrasOS** (`/BrasOS` in Files, `/var/lib/brasos/state/home/BrasOS` on disk). The tray at the right of the taskbar has two buttons for it:

1. **Edit interface** (the pencil) opens Files there. The shell is in `packages/shell/src` (colors and sizes in `shell.css`, your overrides in `user.css`), the components in `packages/ui/src`, each app in `apps/<id>`. Open a file to edit it and save.
2. **Restart interface** (the circular arrow) rebuilds the shell and every app from those files and starts the server again. Open windows close and the screen reloads itself in a few seconds.

An AI agent can do the same through the `system_restart` tool.

If you break it badly:

- After three failed starts in a minute, systemd starts a pristine copy of the shell on its own, and the page reloads into it. Files still works there: undo your edit, then press **Restart interface** to go back to your copy.
- `brasos-reset-shell` replaces your edited copy with a fresh one from the image.

The hardened image is immutable on purpose: you customize it by building a new image, not by editing a running one.

## Build your own pieces

Apps, tools for agents and whole features are covered in [Building apps](04-building-apps.md). The tests and benchmarks that come with each feature are part of it: a change is not finished until it has both.
