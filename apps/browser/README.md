# browser (Religare)

A browser. Permissions: `web.open`, `apps.install`, `db.own`, `window.control`.

**It draws its own title bar.** The manifest says `window.frame: false`, so BrasOS adds no header; the tab strip is the title bar. Empty space in it drags the window (`os.window.moveBy`), **✕** closes it (`os.window.close`), and the window's title follows the page (`os.window.setTitle`). The app draws the window's one-pixel edge itself. The taskbar button's right-click menu still has **Close window**, the way out of any frameless window.

- **Every address goes through the web gateway** (`os.web.open`), so a site gets its own origin, ships TypeScript if it likes (served as JavaScript), and works as a PWA. See [`packages/web-gateway`](../../packages/web-gateway/README.md) for what that means and its limits. The address bar opens only `http` and `https` (`urls.ts`, tested): anything else is refused before it reaches the gateway.
- **Tabs**: each tab is its own frame (all kept alive, the inactive ones hidden) with its own back/forward list of real URLs (a frame's own history isn't reachable across origins, so going back loads the earlier address again). Private tabs record no history. Closed tabs can be reopened (not private ones).
- **The page reports where it really is**, its title and whether it has a PWA manifest (via the SDK the gateway injects), so the address bar shows the real URL, the tab shows the title, history gets a title, and **Install** lights up for installable sites.
- **Omnibox**: a line that is not an address is a search (DuckDuckGo, Bing, Brave Search or Wikipedia; a choice in Settings). Suggestions: favorites first, then history.
- **Favorites, history and settings** live in the app's own space of the OS database (`favorites`, `history`, `settings`), so they survive a restarted window (a fresh origin would lose localStorage). History shows the newest 1000 visits and is not pruned (the database's size limit bounds it); reloading a page within 30 s is not a new visit.
- **Zoom** is per tab (50 to 200%, `Ctrl` + `+`, `-`, `0`).
- **Find in page** (`Ctrl+F`): the page does the searching. The SDK the gateway injects (`packages/sdk/src/site.ts`) listens for a `find` message, and only from the frame's parent at the origin that framed it; it selects the match with `window.find`, counts matches in the page's text nodes and answers with `{ found, count, idx }`. Matches that span several elements are not counted, and a page that was not loaded through the gateway (Storybook) cannot be searched.
- **Pinned tabs** (right-click a tab) are compact, sit first and have no close button; drag a tab to reorder (within pinned or unpinned). **Copy address** is in the menu.
- No third-party images are loaded: a site's badge is a letter and a color from its host.

Shortcuts: `Ctrl+T` new tab, `Ctrl+Shift+N` private tab, `Ctrl+W` close, `Ctrl+Shift+T` reopen, `Ctrl+Tab` next, `Ctrl+L` address bar, `Ctrl+F` find, `Ctrl+R` reload, `Ctrl+D` favorite, `Ctrl+H` history, `Alt+Left/Right` back and forward. In a normal browser tab some of these belong to the browser itself.

Not here: **downloads** (a framed page cannot save files: the sandbox has no `allow-downloads`, and a safe path needs a host capability that fetches through the gateway, saves into the user's Files and audits it, with hardened-policy tests), **saved passwords** (they need encryption at rest and a key store; storing them in the database in plain text would be worse than not having them), **extensions** and **sync** (no extension model, no account or server). Not in the hardened package (the gateway is off there).

Tests: `test/urls.test.ts` here, and `packages/sdk/test/site-find.test.ts` for the page side of find. In Storybook the app runs on the SDK's in-memory database and loads pages directly (no gateway), so many sites refuse to be framed.
