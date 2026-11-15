# Using BrasOS

## The desktop

The desktop shows an icon for every app, followed by whatever is in your `/Desktop` folder. **Double-click** an icon, or select it and press **Enter**, to open it. Folders and files open in **Files**. **Right-click** the desktop for *Open Files* and *Refresh*.

## First start

The first time BrasOS starts, a short setup runs instead of the desktop:

1. **Account**: your name, a username, and a password (at least 10 characters).
2. **Region**: language, time zone, keyboard layout and 12 or 24-hour clock.
3. **Appearance**: the one accent color (amber, mint, ice or mono) that marks focus and selection.
4. **Device**: a name for this computer.
5. **Review**, then **Finish**.

After that the screen is locked with your password when you press the lock button in the tray, and BrasOS asks for it again in a new session. The password locks the screen; it does not encrypt the disk or stop other programs on the machine. The accent, clock and time zone take effect immediately; the keyboard layout, system time zone and device name are recorded for the system to apply. For a fleet of machines, an administrator can provision the account ahead of time (see the setup package's README) so nobody sees the installer.

## The taskbar

The **taskbar** along the bottom works like the one you know:

- **Start** (left) lists every app. Next to it, the **search box** (or **Ctrl+K** anywhere) finds apps, open windows, files in `/Desktop`, `/Documents` and `/Downloads`, and the guides. Arrow keys move through the results, **Enter** opens one, **Escape** closes.
- The **app buttons** open an app, or bring its window forward if it is already open. A small bar under a button means it has a window; a longer, colored bar means its window has the focus.
- The **tray** on the right shows the security mode (on the dev image a warning that it is not secure, on the hardened image *Hardened*), the network, the battery when the machine has one, and the date and time. On the dev image it also has buttons to edit and restart the interface.

## Windows

- Drag a window by its **title bar**. Click a window to bring it to the front. Resize from the bottom-right corner. Close it with **✕**.
- Every window is a separate, isolated program. If one stops answering, the system shows **"isn't responding"** with **Restart** and **Close**; the rest of the system carries on.

## Files

Files shows your home folder: `/Desktop`, `/Documents` and `/Downloads` to start with. Nothing outside your home can be reached.

| To do this | Do this |
|---|---|
| Open a folder | Double-click it, or select it and press **Enter** |
| Go up | The **⬆** button, **Backspace**, or click a part of the path above the list |
| Move the selection | **Up/Down**, **Home**, **End** |
| New folder / new file | The toolbar buttons |
| Rename | Select it, then **Rename** or **F2** |
| Delete | Select it, then **Delete**. It goes to the trash (`/.trash`), it is not erased |
| Preview | Select a file. Text files (up to 1 MB) show their contents and can be edited with **Edit**, then **Save**; small images are shown |

## Browser

Type an address and press Enter. Sites load through the BrasOS web gateway, which gives every site its own isolated origin. That also means a site that ships `.ts` files just works.

If a site is a PWA, **Install** lights up. Installing adds it to the taskbar and desktop as an app. Installed sites get no special permissions.

Limits: a site installed this way runs on a BrasOS address, not its real one, so sign-in flows and features that check the real address (OAuth redirects, passkeys, push notifications) may not work.

## Docs

This app. Pick a page on the left. Links between pages work; links to the web are shown as text and are not clickable.

## Terminal

Dev image only. A real shell on the machine, as the `brasos` user.

## Using only the keyboard

Press **Tab** to move through the taskbar and the desktop icons, **Enter** to open one. Inside an app, **Tab** and the arrow keys work as you would expect. A mouse is never required.
