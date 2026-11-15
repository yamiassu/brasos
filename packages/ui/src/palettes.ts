// The selectable accent palettes. Only the rare colors change (see ui.css); everything neutral stays. One place, used by the shell,
// by apps (the shell sends the choice to every window) and by Storybook.
export const palettes = {
  amber: { label: "Amber", vars: {} as Record<string, string> },
  mint: { label: "Mint", vars: { "--accent": "#6fd8bd", "--accent-2": "#9a8fe0", "--on-accent": "#05140f" } },
  ice: { label: "Ice", vars: { "--accent": "#86c8ee", "--accent-2": "#7c90e6", "--on-accent": "#04121a" } },
  mono: { label: "Mono", vars: { "--accent": "#e8e8ec", "--accent-2": "#9a9aa2", "--on-accent": "#0c0c0d" } },
} as const;

export type PaletteName = keyof typeof palettes;
export const paletteVars = ["--accent", "--accent-2", "--on-accent"];

/** set (or, for the default, clear) the palette's variables on an element, `document.documentElement` usually */
export function applyPalette(name: string, el: { style: CSSStyleDeclaration }) {
  for (const k of paletteVars) el.style.removeProperty(k);
  const p = (palettes as Record<string, { vars: Record<string, string> }>)[name];
  if (p) for (const [k, v] of Object.entries(p.vars)) el.style.setProperty(k, v);
}
