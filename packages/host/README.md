# host

The composition root. It serves every origin, applies the one capability gate, serves the built UI, and plugs the slices together. It contains no feature of its own.

- **Origins** (`src/host.ts`): `localhost` is the shell, `<id>.localhost` an app, `<32 hex>.web.localhost` a website loaded through the gateway. Any other Host header is refused and audited.
- **Capability gate** (`ctx.gate(cap)`): caller identity from the browser-set `Origin` header, permission from the caller's manifest, every enabled package's policy, audited allow and deny. Slices call it; they never decide who is allowed.
- **Slices** (`src/types.ts`): `{ name, handle?(req, ctx), ws? }`. Built in: registry, web-gateway. Apps add theirs with `apps/<id>/server.ts` exporting `createSlice({ audit })`; it is loaded only if the registry admits the app.
- **Packages** (`src/packages.ts`): `BRASOS_PACKAGES=hardened` turns on policy packages. Unknown names throw.
- **Build** (`src/build.ts`): bundles the shell, apps and the standalone SDK into `dist`. Under Nix this runs once at image build time (`--build-only`); the running server then uses `BRASOS_PREBUILT=1` and never builds.
- **Config** (`src/main.ts`): `PORT`, `BRASOS_PACKAGES`, `BRASOS_DIST`, `BRASOS_PREBUILT`, `BRASOS_STATE_DIR`, `BRASOS_AUDIT_FILE`, `BRASOS_WEB_ALLOW_PRIVATE` (tests/dev only).
- **Testing**: `src/testing.ts` starts a real host on a free port for any slice's tests.

Tests: `test/host.test.ts`. Benchmarks: `bench.ts` (`host.*`, `registry.list`). Nix: `module.nix` defines the `brasos.src` option.
