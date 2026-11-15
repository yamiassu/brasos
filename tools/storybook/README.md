# Storybook

The UI kit and the apps in a browser, so the look can be tweaked without booting the VM.

```bash
bun run storybook        # http://localhost:6006
```

- **Stories** sit next to what they show (`packages/ui/src/ui.stories.tsx`, `apps/files/files.stories.tsx`, ...): plain CSF objects, so the repo needs no Storybook types. Add one beside any new component or app.
- **The polyfill.** Stories run with no BrasOS host. `@brasos/sdk` detects that it is not inside BrasOS (`standalone`, set in `.storybook/preview.tsx`, because Storybook is served from localhost too) and uses its polyfills: `os.fs` is an in-memory tree (`packages/sdk/src/memory-fs.ts`, same rules as the host: virtual paths, `..` collapses, delete goes to `/.trash`), and the guides come from the page (`docs/guide/*.md`, rendered crudely). Apps export their component (`export { Files }`) and only mount when the page has a `#root`.
- **Live tweaking.** Edit `packages/ui/src/ui.css` or `packages/shell/src/user.css` and the stories update. The toolbar's *Palette* swaps the rare colors (amber and coral, mint and violet, ice and blue, mono) without editing files.
- **Isolated dependencies.** Storybook and Vite are installed here (`tools/storybook/node_modules`, own `bun.lock`), never at the repo root: the OS image, the dev VM's boot-time `bun install` and the hardened build's pinned hash don't see them. `tools/` is not in the image source. Telemetry is off.
- Not covered: anything that needs a real host (the terminal, the web gateway, the agent interface). The Files story shows the app, not the host's file confinement; that is tested in `packages/files/test`.
