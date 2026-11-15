# registry

The list of things you can open. An app is a [Web App Manifest](https://www.w3.org/TR/appmanifest/) (the PWA standard) plus an optional `brasos` block:

```json
{ "name": "Terminal", "short_name": "Terminal", "start_url": "/", "display": "standalone",
  "brasos": { "icon": "⌨️", "permissions": ["pty"], "hardened": false } }
```

- **Built-in apps** live in `apps/<id>/manifest.webmanifest`.
- **Installed PWAs** are stored as JSON in `$BRASOS_STATE_DIR/apps/`. A remote manifest is validated (needs a name; `start_url` must be on the manifest's own origin) and installed with **no permissions**: it can't grant itself any, whatever it claims.
- **Policies** (e.g. hardened) filter the list. An installed PWA has no `brasos` block, so a policy that requires an opt-in hides it.
- **Routes** (shell origin): `GET /os/apps` (`apps.read`), `POST /os/apps/install` (`apps.install`), `POST /os/apps/uninstall` (`apps.uninstall`). Fetching a remote manifest uses the gateway's SSRF-safe fetch, injected by the host.

Shortcut: manifest icons are ignored; every PWA gets the same icon.

Tests: `test/registry.test.ts`.
