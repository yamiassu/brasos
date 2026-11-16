// The selectable accent palettes. Only the rare colors change (see ui.css); everything neutral stays. One place, used by the shell,
// by apps (the shell sends the choice to every window) and by Storybook. `swatch` is the pair shown when choosing.
export const palettes = {
  green: { label: "Green and violet", swatch: ["#5fd39a", "#9b87f5"], vars: {} as Record<string, string> }, // the default: ui.css
  amber: { label: "Amber and coral", swatch: ["#e3b36b", "#d98a94"], vars: { "--accent": "#e3b36b", "--accent-2": "#d98a94", "--on-accent": "#17110a" } },
  mint: { label: "Mint", swatch: ["#6fd8bd", "#9a8fe0"], vars: { "--accent": "#6fd8bd", "--accent-2": "#9a8fe0", "--on-accent": "#05140f" } },
  ice: { label: "Ice", swatch: ["#86c8ee", "#7c90e6"], vars: { "--accent": "#86c8ee", "--accent-2": "#7c90e6", "--on-accent": "#04121a" } },
  mono: { label: "Mono", swatch: ["#e8e8ec", "#9a9aa2"], vars: { "--accent": "#e8e8ec", "--accent-2": "#9a9aa2", "--on-accent": "#0c0c0d" } },
} as const;

export type PaletteName = keyof typeof palettes;
export const paletteVars = ["--accent", "--accent-2", "--on-accent"];

/** set (or, for the default, clear) the palette's variables on an element, `document.documentElement` usually */
export function applyPalette(name: string, el: { style: CSSStyleDeclaration }) {
  for (const k of paletteVars) el.style.removeProperty(k);
  const p = (palettes as Record<string, { vars: Record<string, string> }>)[name];
  if (p) for (const [k, v] of Object.entries(p.vars)) el.style.setProperty(k, v);
}
