# Using BrasOS

## The desktop

The desktop shows an icon for every app, followed by whatever is in your `/Desktop` folder. **Double-click** an icon, or select it and press **Enter**, to open it. Folders and files open in **Files**. **Right-click** the desktop for *Open Files* and *Refresh*.

The **dock** along the bottom has a button for every app. On the dev image it also shows an orange warning that this is not a secure image.

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

If a site is a PWA, **Install** lights up. Installing adds it to the dock and desktop as an app. Installed sites get no special permissions.

Limits: a site installed this way runs on a BrasOS address, not its real one, so sign-in flows and features that check the real address (OAuth redirects, passkeys, push notifications) may not work.

## Docs

This app. Pick a page on the left. Links between pages work; links to the web are shown as text and are not clickable.

## Terminal

Dev image only. A real shell on the machine, as the `brasos` user.

## Using only the keyboard

Press **Tab** to move through the dock and the desktop icons, **Enter** to open one. Inside an app, **Tab** and the arrow keys work as you would expect. A mouse is never required.
