// The sidebar shows the BrasOS logo instead of Storybook's.
import { addons } from "storybook/manager-api";
import { create } from "storybook/theming/create";

addons.setConfig({
  theme: create({ base: "dark", brandTitle: "BrasOS", brandImage: "/brand/logo.svg", brandUrl: "/" }),
});
