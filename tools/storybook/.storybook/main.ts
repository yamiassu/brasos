// Storybook for the UI kit and the apps, so the look can be tweaked in a browser without booting the VM.
// Its dependencies live in tools/storybook/ only; the OS image and the hardened build never install them.
import { resolve } from "node:path";
import type { StorybookConfig } from "@storybook/react-vite";

const root = resolve(import.meta.dirname, "../../..");

const config: StorybookConfig = {
  stories: [`${root}/packages/**/*.stories.@(ts|tsx)`, `${root}/apps/**/*.stories.@(ts|tsx)`],
  framework: "@storybook/react-vite",
  addons: [],
  staticDirs: [{ from: `${root}/docs/brand`, to: "/brand" }],
  core: { disableTelemetry: true },
  viteFinal(c) {
    // the same aliases as the repo's tsconfig, and one copy of React (the repo's), whatever Storybook installed beside it
    const a = (find: string | RegExp, to: string) => ({ find, replacement: to });
    c.resolve = {
      ...c.resolve,
      alias: [
        a(/^@brasos\/ui\/(.+)$/, `${root}/packages/ui/src/$1`),
        a("@brasos/ui", `${root}/packages/ui/src/index.ts`),
        a("@brasos/sdk", `${root}/packages/sdk/src/index.ts`),
        a(/^react$/, `${root}/node_modules/react`),
        a(/^react\/(.+)$/, `${root}/node_modules/react/$1`),
        a(/^react-dom$/, `${root}/node_modules/react-dom`),
        a(/^react-dom\/(.+)$/, `${root}/node_modules/react-dom/$1`),
      ],
      dedupe: ["react", "react-dom"],
    };
    c.server = { ...c.server, fs: { ...c.server?.fs, allow: [root] } };
    return c;
  },
};
export default config;
