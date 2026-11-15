# Concepts

## Apps are PWAs

An app is a [Web App Manifest](https://www.w3.org/TR/appmanifest/) (the standard file that describes a PWA) plus a small extension block for BrasOS. Built-in apps live in `apps/<id>/manifest.webmanifest`; apps installed from the web are stored with the same shape.

```json
{
  "name": "Files", "short_name": "Files", "start_url": "/", "display": "standalone",
  "brasos": {
    "icon": "📁",
    "permissions": [{ "id": "fs.read", "reason": "Show your files" }, "fs.write"],
    "window": { "frame": true },
    "hardened": false
  }
}
```

- `permissions`: what the app can do, each an id or `{ id, reason }`. A built-in app holds what it lists. For an app installed from the web this is only a **request**: when you install it, BrasOS shows each permission in plain words with the app's reason and you choose what to allow.
- `window.frame: false`: BrasOS draws no title bar; the app draws its own and controls its window through `os.window` (it needs `window.control`, and an installed web app needs `window.frameless`, which you also approve at install). Right-clicking the app's button on the taskbar always closes its windows.

## Everything isolated by origin

Each app is served from its own address, `http://<app>.localhost:7000`. The browser engine treats different addresses as different security origins and runs them in separate processes, so one app cannot read another's data, and a crash or hang stays inside its window. Websites loaded in the Browser get their own address too (`http://<32 hex characters>.web.localhost:7000`).

## Capabilities and permissions

Anything powerful (files, the terminal, the web, installing apps) is a **capability**. An app may use a capability only if its manifest lists it under `brasos.permissions`. The host checks every request, on the server, identifying the caller by the origin the browser reports (a page cannot forge it), and records the decision in the audit trail.

| Capability | What it allows |
|---|---|
| `fs.read`, `fs.write` | Read, or change, files in the user's home |
| `pty` | The terminal |
| `web.open` | Open websites through the gateway |
| `apps.install` | Install PWAs |
| `docs.read` | Read these guides |
| `db.own`, `db.shared` | Use the BrasOS database privately, or share data with other apps and hear their changes |
| `window.control`, `window.frameless` | Control its own window; draw its own frame |

A website you simply browse to has no permissions. A web app you **install** has only what you allowed in the install prompt, and never anything outside a short list (files, the BrasOS database, its own window, opening apps); it can't restart the system, run commands or install other apps.

## Packages and profiles

Optional parts of the system are **packages** you switch on. The main one is **hardened**: with it on, only apps that explicitly opt in are available, and the terminal, files, web gateway, agents and installing are all off. A package can only make the system stricter, never looser.

Two images are built from the same sources: the **dev** image (hardened off) and the **hardened** image (hardened on).

## The audit trail

Every decision about a powerful capability is written to a tamper-evident log, one line per event, each linked to the one before by a hash. A verifier detects edited, deleted or reordered lines. See [Security](08-security.md).

## How a page talks to the system

Through the **SDK** (`@brasos/sdk`): ordinary JavaScript calls that the host checks against the app's permissions. See the [SDK reference](05-sdk-reference.md).
