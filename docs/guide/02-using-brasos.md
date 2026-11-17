# Using BrasOS

## The desktop

The desktop shows an icon for every app, followed by whatever is in your `/Desktop` folder. **Double-click** an icon, or select it and press **Enter**, to open it. Folders and files open in **Files**. **Drag** an icon to move it to any free spot; it stays where you put it. **Right-click** an app icon (or press **Delete** on it) to *Remove from desktop*: the app stays installed, and is still in Start and the taskbar. **Right-click** the desktop for *Open Files*, *Refresh*, *Arrange icons* and, once you have removed something, *Show removed apps*.

## First start

The first time BrasOS starts, a short setup runs instead of the desktop:

1. **Account**: your name, a username, and a password (at least 10 characters).
2. **Region**: language, time zone, keyboard layout and 12 or 24-hour clock.
3. **Appearance**: the one accent color (green and violet, amber and coral, mint, ice or mono) that marks focus and selection.
4. **Device**: a name for this computer.
5. **Review**, then **Finish**.

After that the screen is locked with your password when you press the lock button in the tray, and BrasOS asks for it again in a new session. The password locks the screen; it does not encrypt the disk or stop other programs on the machine. The accent, clock and time zone take effect immediately; the keyboard layout, system time zone and device name are recorded for the system to apply. For a fleet of machines, an administrator can provision the account ahead of time (see the setup package's README) so nobody sees the installer.

**More accounts.** The account you made is the owner. In **Settings → Accounts** the owner can add accounts for other people, rename them, set a new password and remove them (each change asks for your password again). Everyone then picks their account on the lock screen and has their own password and optional PIN. These are lock-screen profiles, not separate computer users: all accounts see the same files and apps.

## The taskbar

The **taskbar** along the bottom works like the one you know:

- **Start** (left) shows your pinned apps and a few of your files; **All apps** lists the rest. Next to it, the **search box** (or **Ctrl+K** anywhere) finds apps, open windows, files in `/Desktop`, `/Documents` and `/Downloads`, and the guides. Arrow keys move through the results, **Enter** opens one, **Escape** closes.
- The **app buttons** open an app, or bring its window forward if it is already open. A small bar under a button means it has a window; a longer, colored bar means its window has the focus.
- **Right-click** an app button, or an app in Start, to open it in a new window, close its windows, or **pin** and **unpin** it on the taskbar and in Start. Unpinning only hides the app (it stays in All apps and in search), and an app with a window open always shows on the taskbar.
- The **tray** on the right shows the security mode (on the dev image a warning that it is not secure, on the hardened image *Hardened*), the network, the battery when the machine has one, and the date and time. On the dev image it also has buttons to edit and restart the interface.

## Windows

- Drag a window by its **title bar**. Click a window to bring it to the front. Resize from the bottom-right corner. The buttons at the right of the title bar **minimize** it (the app keeps running; its taskbar button brings it back), **maximize** it (press again to restore the size it had) and **close** it. A **double click** on the title bar also maximizes and restores. Dragging a maximized window by its title bar returns it to its normal size, with the pointer at the same place on the bar. Drag a window to the very top of the screen and a green preview shows where it will go; let go there and it maximizes. On the taskbar, clicking the button of the app that has the focus minimizes its window. Apps that draw their own title bar (like Religare) have the same buttons and double click.
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

## Religare

Type an address and press Enter. Sites load through the BrasOS web gateway, which gives every site its own isolated origin. That also means a site that ships `.ts` files just works.

- **Address bar.** Type an address, or anything else to search (DuckDuckGo by default; change it in Settings). Suggestions come from your favorites and history. Only web addresses (`http`, `https`) open.
- **Tabs.** **+** or **Ctrl+T** opens one, **Ctrl+W** closes it, **Ctrl+Shift+T** brings back the last closed tab, **Ctrl+Tab** switches, and a middle click closes. Right-click a tab to reload, duplicate or close the others.
- **Favorites.** **☆** (or **Ctrl+D**) saves the page. They show on a bar under the address bar, and on the new tab page.
- **History.** **Ctrl+H** opens the history, grouped by day, with search; remove one entry or clear all. A **private tab** (**Ctrl+Shift+N**) adds nothing to history.
- **Find in page.** **Ctrl+F** searches the page, with the number of matches; **Enter** and **Shift+Enter** go to the next and previous match.
- **Pinned tabs.** Right-click a tab and choose **Pin tab**: it shrinks to an icon and stays first. Drag tabs to reorder them.
- **The menu (⋮)** has find, copy address, zoom, the panels, the favorites bar switch, and **Settings** (search engine, home page).

Favorites, history and settings are kept in the app's own space in the OS database, so they survive a restart.

If a site is a PWA, **Install** lights up. Installing adds it to the taskbar and desktop as an app. Installed sites get no special permissions.

Limits: a site installed this way runs on a BrasOS address, not its real one, so sign-in flows and features that check the real address (OAuth redirects, passkeys, push notifications) may not work.

## Getting apps

In **Packages**, **Get apps** searches Flathub, the Linux app store, and installs or removes apps for you (Steam, Discord, VLC and many more). A progress bar shows what is happening, how long it has been going and when it last did anything, so a quiet stretch can be told from a stuck one. An installed app appears in Start like the others. This is on the dev image only: apps from the store run as you in their own sandbox, are not reviewed by BrasOS and are downloaded from the internet, so the hardened image never has it. Websites such as Steam's offer `.deb` files; those are for Debian-based systems and cannot be installed here, so use **Get apps** instead.

## Docs

This app. Pick a page on the left. Links between pages work; links to the web are shown as text and are not clickable.

## Terminal

Dev image only. A real shell on the machine, as the `brasos` user. Each tab is its own session: **+** (or **Ctrl+Shift+T**) opens one, **×** (or **Ctrl+Shift+W**, or a middle click) closes it, and **Ctrl+Shift+Left/Right** switches. A tab whose shell has exited stays, crossed out, until you close it.

**Copy and paste:** with text selected, **Ctrl+C** copies it (with nothing selected it is the usual interrupt for the running program); **Ctrl+Shift+C** always copies. **Ctrl+V** or **Ctrl+Shift+V** pastes. **Ctrl+click** or **Ctrl+right-click** on a web address (or on a selected one) opens it in the browser app.

## Using only the keyboard

Press **Tab** to move through the taskbar and the desktop icons, **Enter** to open one. Inside an app, **Tab** and the arrow keys work as you would expect. A mouse is never required.
