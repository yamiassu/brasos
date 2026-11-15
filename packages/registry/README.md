# registry

The list of things you can open. An app is a [Web App Manifest](https://www.w3.org/TR/appmanifest/) (the PWA standard) plus an optional `brasos` block:

```json
{ "name": "Terminal", "short_name": "Terminal", "start_url": "/", "display": "standalone",
  "brasos": { "icon": "⌨️", "permissions": ["pty"], "hardened": false } }
```

- **Built-in apps** live in `apps/<id>/manifest.webmanifest`.
- **Installed PWAs** are stored as JSON in `$BRASOS_STATE_DIR/apps/`. A remote manifest is validated (needs a name; `start_url` must be on the manifest's own origin). It can only **request** permissions (`brasos.permissions`, each a string or `{ id, reason }`) and a frameless window (`brasos.window.frame: false`, which counts as requesting `window.frameless`). The **user grants** a subset in the install prompt; what is stored as `permissions` is the intersection of what was asked, what was ticked and what a website may ever hold (`PWA_GRANTABLE` in the host). The record keeps `requested` too, so the app can be shown what it asked for.
- **Policies** (e.g. hardened) filter the list. An installed PWA has no `brasos` block, so a policy that requires an opt-in hides it.
- **Routes** (shell origin): `GET /os/apps` (`apps.read`), `POST /os/apps/inspect` (`apps.install`: fetch the manifest and describe the requests, store nothing), `POST /os/apps/install` with `{ manifestUrl, grant: [ids] }`, `POST /os/apps/uninstall`. Install, inspect and uninstall are the **shell's** (same-origin): the shell shows the prompt, so no page can install or grant by calling the host. An app with the `apps.install` permission asks the shell through the SDK. Fetching a remote manifest uses the gateway's SSRF-safe fetch, injected by the host.

Shortcut: manifest icons are ignored; every PWA gets the same icon.

Tests: `test/registry.test.ts`.
