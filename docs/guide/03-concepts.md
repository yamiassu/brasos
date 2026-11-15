# Concepts

## Apps are PWAs

An app is a [Web App Manifest](https://www.w3.org/TR/appmanifest/) (the standard file that describes a PWA) plus a small extension block for BrasOS. Built-in apps live in `apps/<id>/manifest.webmanifest`; apps installed from the web are stored with the same shape.

```json
{
  "name": "Files", "short_name": "Files", "start_url": "/", "display": "standalone",
  "brasos": { "icon": "📁", "permissions": ["fs.read", "fs.write"], "hardened": false }
}
```

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

Websites and installed PWAs never receive permissions, whatever their manifest claims.

## Packages and profiles

Optional parts of the system are **packages** you switch on. The main one is **hardened**: with it on, only apps that explicitly opt in are available, and the terminal, files, web gateway, agents and installing are all off. A package can only make the system stricter, never looser.

Two images are built from the same sources: the **dev** image (hardened off) and the **hardened** image (hardened on).

## The audit trail

Every decision about a powerful capability is written to a tamper-evident log, one line per event, each linked to the one before by a hash. A verifier detects edited, deleted or reordered lines. See [Security](08-security.md).

## How a page talks to the system

Through the **SDK** (`@brasos/sdk`): ordinary JavaScript calls that the host checks against the app's permissions. See the [SDK reference](05-sdk-reference.md).
