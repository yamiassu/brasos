# browser

A small browser. Permissions: `web.open`, `apps.install`.

- Every address goes through the web gateway (`os.web.open`), so a site gets its own origin, ships TypeScript if it likes (served as JavaScript), and works as a PWA. See [`packages/web-gateway`](../../packages/web-gateway/README.md) for what that means and its limits.
- The page inside the frame reports where it really is and whether it has a PWA manifest (via the SDK the gateway injects), so the address bar shows the real URL and **Install** lights up for installable sites.
- **Install** adds the site to the registry as an app with no permissions; the dock refreshes.
- Back/forward keep the browser's own history of real URLs (the frame's own history isn't reachable across origins).

Not in the hardened package (the gateway is off there).
