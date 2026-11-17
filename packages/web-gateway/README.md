# web-gateway

Loads websites through the host. It is the only way BrasOS touches the web, so it is the one place to audit and restrict.

## What it does

- **A site per origin.** `POST /os/web/open {url}` (permission `web.open`) returns `http://<id>.web.localhost:<port>/...`. The id is an HMAC of the site's real origin, so it is stable across restarts (when `BRASOS_STATE_DIR` holds the key), unguessable, and unique per site. `*.localhost` is a secure context, so service workers and PWAs work, and each site is isolated from the others and from the OS.
- **TypeScript instead of JavaScript.** A site may ship `.ts`/`.mts`/`.cts`; when the browser loads one as a script (`Sec-Fetch-Dest: script`, or no hint and not media) the gateway transpiles it with `Bun.Transpiler` and serves it as `text/javascript`, whatever MIME the site used (`.ts` is often `video/mp2t`). Syntax errors come back as a readable 502.
- **Framing and CSP.** Strips `X-Frame-Options`, CSP, COOP/COEP/CORP, HSTS; removes CSP `<meta>` tags; rewrites absolute `href`/`src`/`action`/`poster`/`formaction` and `Location` so links stay inside the gateway.
- **The SDK.** Injects `window.__BRASOS_SITE__` (the real origin) and `/__brasos/sdk.js`, which reports navigation and the PWA manifest to the framing browser app and answers the shell's heartbeat.
- **Devtools.** F12 (or Ctrl+Shift+I/J/C) inside a website opens an in-page devtools panel: the vendored Eruda (`vendor/`, see its README for version, source and checksum), served at `/__brasos/devtools.js` to website origins only and never when a package (hardened) is on. A page cannot open Chromium's own devtools, so the desktop's F12 is left alone and the website gets its own.
- **Cookies and POST** are forwarded (`Domain` dropped, every cookie made `SameSite=None; Secure; Partitioned`: a site runs in an iframe under the desktop, so the browser treats its cookies as third-party and would otherwise store none, which broke every cookie-based sign-in. Checked in Chromium with a stand-in site: `none`, `lax`, no-attribute and `__Host-` cookies all stored and sent).

## Safety

- **SSRF.** `fetchPublic` refuses loopback, private, link-local (incl. cloud metadata), CGNAT, multicast and v4-mapped/NAT64 forms, resolves DNS first, bounds time (15 s) and size (25 MB), and re-checks every redirect it follows. Schemes other than http(s) and URLs with credentials are refused at `open`.
- **No powers for websites.** A page on a gateway origin holds no OS permissions; a remote manifest can't grant itself any.
- **Audited**: `capability.web.open` allow/deny, `web.open`, `web.site` (first request per site), `web.blocked`.
- **Off in the hardened package** (capability denied) until a web allowlist policy exists.

## Known limits (`shortcut:` in the code)

DNS rebinding window between resolve and connect; no WebSocket pass-through; `srcset`, CSS `url()` and script-built URLs aren't rewritten (the hardened browser policy blocks those; dev lets them through); `.tsx` isn't served (needs an import map for the JSX runtime); a PWA runs on a gateway origin, not its real one, so OAuth/WebAuthn/push that check the real origin won't work.

Tests: `test/address.test.ts` (address classification), `test/gateway.test.ts` (end to end against a local site). Benchmarks: `bench.ts`.
