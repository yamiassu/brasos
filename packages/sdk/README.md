# @brasos/sdk

Talk to BrasOS from a web page. Inside BrasOS it calls the host; anywhere else every call degrades to a polyfill, so one codebase also runs on a plain browser. `os.fs` polyfills to an in-memory tree (`src/memory-fs.ts`); a page may supply its own fs and guides via `globalThis.__brasosPolyfill` (Storybook does, see `tools/storybook`).

```ts
import { os } from "@brasos/sdk";

os.available                       // true inside BrasOS
await os.info()                    // { os: "brasos", packages: [...] }   | polyfill: { os: null, packages: [] }
await os.apps.list()               // permission apps.read                | polyfill: []
await os.apps.open("terminal")     // asks the shell (needs apps.open)    | polyfill: false
await os.apps.install(manifestUrl) // permission apps.install             | polyfill: rejects UnsupportedError
await os.web.open("https://…")     // permission web.open → gateway URL   | polyfill: the URL itself
```

Importing it also makes the window answer the shell's heartbeat.

## Two ways to load it

- **As a module** in apps: `import { os } from "@brasos/sdk"` (path alias in `tsconfig.json`).
- **As a script** anywhere: `/__brasos/sdk.js` (an IIFE exposing `window.brasos`), served by the host on every origin. The web gateway injects it into every website it loads, together with a reporter that tells the framing browser app the page's real URL and PWA manifest.

## How calls are authorized

The SDK only makes requests; the host decides. Calls go to `http://localhost:<port>/os/*` from the caller's own origin, where the host identifies the caller by its `Origin` header and checks the manifest permission and the enabled packages' policies. A page without the permission gets a 403 (surfaced as an `Error`).

Tests: `test/sdk.test.ts` (inside and outside BrasOS, with fakes).
