# files

The user's files. A filesystem confined to one directory (the BrasOS home), exposed as routes for apps and as tools for AI agents.

- **Home.** `$BRASOS_HOME`, defaulting to `<state dir>/home`; without either, files are unavailable (503). Created on first run with `/Desktop`, `/Documents`, `/Downloads`.
- **Virtual absolute paths.** `/Desktop/notes.txt`. `..` collapses at the root, backslashes, NUL and over-long names are refused, and a symlink that leads outside the home is refused, including when overwriting an existing file that is itself a link.
- **Operations** (`POST /os/fs/<op>`): `list`, `stat`, `read` (utf8 or base64, up to 1 MiB, with a `truncated` flag), `write` (up to 5 MiB, parent must exist), `mkdir`, `move` (the destination must not exist; a folder can't move into itself), `delete` (moves to `/.trash/<timestamp>-<name>`; the trash is hidden from the root listing and can't itself be deleted from).
- **Capabilities.** `fs.read` for the first three, `fs.write` for the rest. The shell holds `fs.read` (the desktop); the Files app holds both. Reads are audited quietly (throttled), changes as `fs.change` events.
- **Agent tools.** `fs_list`, `fs_read`, `fs_write`, `fs_mkdir`, `fs_move`, `fs_delete`, declared next to the routes and sharing the same operations, so an agent can't do anything the Files app can't.
- **Off in the hardened package.**

Shortcut: `fs.read`/`fs.write` cover the whole home; scoping per app is future work.

Tests: `test/files.test.ts` (containment, symlinks, limits, trash, permissions, audit). Benchmarks: `bench.ts`.
