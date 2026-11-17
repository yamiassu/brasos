# system

Change the OS from inside it: restart the interface so edits take effect, rebuild without restarting, and scaffold a new app.

- `POST /os/system/restart` (capability `system.restart`, same-origin only) and the agent tool `system_restart`. The server answers, then runs the supervisor's restart command and starts again: the shell and every app are rebuilt from the source on disk, and the open page reloads itself.
- `POST /os/system/rebuild` and the agent tool `system_rebuild`: rebuild the shell and every app into `dist` from the source on disk (new apps included) without restarting. The shell's *Reload* button calls it, then reloads the page. An app's `server.ts` is loaded only at start, so a restart is still needed for that.
- `POST /os/system/app` `{ id, name, icon? }` and the agent tool `app_create`: write `apps/<id>/{manifest.webmanifest,index.html,main.ts}` and rebuild. The id is 2-30 lowercase letters, digits and single dashes (`--` is reserved for restarted windows), it never overwrites an existing app, and everything is validated before anything is written. The shell's *New app* button calls it.
- All three routes use `system.restart` (same-origin) and exist only where the host has a supervisor and builds its own apps (the dev image; not with `BRASOS_PREBUILT`). Audited: `system.restart`, `system.rebuild`, `system.app_create` (never contents).
- Present only when `BRASOS_RESTART_CMD` is set (the dev image sets it). Without it the route answers 501 and there is no tool. `/os/info` reports `restart: true|false` so the shell knows whether to show the buttons.
- The shell holds `system.restart`; apps may ask for it in their manifest. The hardened package denies it (it is not in its allow-list).
- Audited: `capability.system.restart` (allow/deny) and `system.restart`.
- If the edited code no longer starts, systemd falls back to the pristine copy (see `packages/devtools`), and Files still works there so the edit can be undone.
