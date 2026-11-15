# system

Restart the interface so edits to the OS's own source take effect.

- `POST /os/system/restart` (capability `system.restart`, same-origin only) and the agent tool `system_restart`. The server answers, then runs the supervisor's restart command and starts again: the shell and every app are rebuilt from the source on disk, and the open page reloads itself.
- Present only when `BRASOS_RESTART_CMD` is set (the dev image sets it). Without it the route answers 501 and there is no tool. `/os/info` reports `restart: true|false` so the shell knows whether to show the buttons.
- The shell holds `system.restart`; apps may ask for it in their manifest. The hardened package denies it (it is not in its allow-list).
- Audited: `capability.system.restart` (allow/deny) and `system.restart`.
- If the edited code no longer starts, systemd falls back to the pristine copy (see `packages/devtools`), and Files still works there so the edit can be undone.
