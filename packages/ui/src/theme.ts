// The user's theme: a preset plus optional custom colors, a corner radius and a wallpaper. One pure module (no DOM): the Settings app
// edits a Theme, the shell turns it into CSS variables for itself and for every built-in window, Storybook uses the same code.
// Everything that reaches CSS is validated here (plain #rrggbb colors, bounded numbers, fixed wallpaper kinds), so a stored or
// posted theme can't inject styles.

export type Wallpaper = { kind: "default" | "solid" | "gradient"; a?: string; b?: string; angle?: number };
export type Theme = {
  preset: string;
  custom: { accent?: string; accent2?: string; bg?: string; panel?: string; text?: string };
  radius?: number; // px, 0 to 20
  wallpaper: Wallpaper;
};

/** the variables a theme may set (the SDK's allowlist for windows must include them all: a test checks) */
export const themeVarNames = [
  "--bg", "--panel", "--panel-2", "--text", "--muted", "--icon", "--icon-hi", "--border", "--border-strong", "--hover", "--selected",
  "--accent", "--accent-2", "--on-accent", "--radius", "--radius-sm",
] as const;
/** set only on the shell itself: the desktop background */
export const WALLPAPER_VAR = "--wallpaper";

type Preset = { label: string; swatch: string[]; vars: Record<string, string>; wallpaper?: Wallpaper };
const light = {
  "--bg": "#f2f2ee", "--panel": "#ffffff", "--panel-2": "#ecece6", "--text": "#1b1b1f", "--muted": "#6b6b73", "--icon": "#3a3a42", "--icon-hi": "#8a8a92",
  "--border": "#00000018", "--border-strong": "#00000033", "--hover": "#0000000d", "--selected": "#0000001a",
  "--accent": "#1f9d6b", "--accent-2": "#6a55d6", "--on-accent": "#ffffff",
};
export const themePresets: Record<string, Preset> = {
  night: { label: "Night", swatch: ["#0c0c0d", "#131314", "#5fd39a"], vars: {} }, // the default: ui.css
  graphite: { label: "Graphite", swatch: ["#141516", "#1d2023", "#9aa0aa"], vars: { "--bg": "#141516", "--panel": "#1d2023", "--panel-2": "#262a2e" } },
  midnight: {
    label: "Midnight", swatch: ["#0a1020", "#101a30", "#7aa2ff"],
    vars: { "--bg": "#0a1020", "--panel": "#101a30", "--panel-2": "#16223d", "--accent": "#7aa2ff", "--accent-2": "#b48cff", "--on-accent": "#06101f" },
    wallpaper: { kind: "gradient", a: "#0a1020", b: "#1a1f4d", angle: 160 },
  },
  forest: {
    label: "Forest", swatch: ["#0a1410", "#10201a", "#6fd8a0"],
    vars: { "--bg": "#0a1410", "--panel": "#10201a", "--panel-2": "#162a22", "--accent": "#6fd8a0", "--accent-2": "#c8d86f", "--on-accent": "#05140c" },
    wallpaper: { kind: "gradient", a: "#0a1410", b: "#17352a", angle: 150 },
  },
  paper: { label: "Paper (light)", swatch: ["#f2f2ee", "#ffffff", "#1f9d6b"], vars: light },
};

export const defaultTheme = (): Theme => ({ preset: "night", custom: {}, wallpaper: { kind: "default" } });

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v: unknown): string | undefined => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : undefined);
const num = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : undefined);

/** whatever was stored or typed, made into a valid theme (unknown fields dropped, bad values ignored) */
export function validateTheme(x: any): Theme {
  const t = defaultTheme();
  if (!x || typeof x !== "object") return t;
  if (typeof x.preset === "string" && x.preset in themePresets) t.preset = x.preset;
  for (const k of ["accent", "accent2", "bg", "panel", "text"] as const) {
    const v = hex(x.custom?.[k]);
    if (v) t.custom[k] = v;
  }
  t.radius = num(x.radius, 0, 20);
  const w = x.wallpaper;
  if (w && (w.kind === "solid" || w.kind === "gradient")) {
    t.wallpaper = { kind: w.kind, a: hex(w.a) ?? "#0c0c0d", ...(w.kind === "gradient" ? { b: hex(w.b) ?? "#1a1a2e", angle: num(w.angle, 0, 360) ?? 135 } : {}) };
  }
  return t;
}

const lum = (c: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const mix = (a: string, b: string, t: number) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, "0")).join("");

/** the CSS variables for a theme: only names in `themeVarNames`, only validated values; wallpaper separately (shell only) */
export function themeVars(theme: Theme): { vars: Record<string, string>; wallpaper: string } {
  const t = validateTheme(theme);
  const vars: Record<string, string> = { ...themePresets[t.preset].vars };
  const c = t.custom;
  if (c.bg) {
    vars["--bg"] = c.bg;
    const dark = lum(c.bg) < 0.4;
    // surfaces follow the background unless the user picked them: a little toward the text side
    if (!c.panel) vars["--panel"] = mix(c.bg, dark ? "#ffffff" : "#000000", 0.05);
    vars["--panel-2"] = mix(c.bg, dark ? "#ffffff" : "#000000", 0.09);
    Object.assign(vars, dark
      ? { "--border": "#ffffff14", "--border-strong": "#ffffff30", "--hover": "#ffffff0d", "--selected": "#ffffff1a", "--icon": "#c9c9cf", "--icon-hi": "#7c7c84" }
      : { "--border": "#00000018", "--border-strong": "#00000033", "--hover": "#0000000d", "--selected": "#0000001a", "--icon": "#3a3a42", "--icon-hi": "#8a8a92" });
    if (!c.text) Object.assign(vars, dark ? { "--text": "#ececee", "--muted": "#8b8b92" } : { "--text": "#1b1b1f", "--muted": "#6b6b73" });
  }
  if (c.panel) (vars["--panel"] = c.panel, (vars["--panel-2"] = mix(c.panel, lum(c.panel) < 0.4 ? "#ffffff" : "#000000", 0.05)));
  if (c.text) (vars["--text"] = c.text, (vars["--muted"] = mix(c.text, vars["--bg"] ?? "#0c0c0d", 0.45)));
  if (c.accent) (vars["--accent"] = c.accent, (vars["--on-accent"] = lum(c.accent) > 0.4 ? "#0c0c0d" : "#ffffff"));
  if (c.accent2) vars["--accent-2"] = c.accent2;
  if (t.radius !== undefined) (vars["--radius"] = `${t.radius}px`, (vars["--radius-sm"] = `${Math.max(0, Math.round(t.radius * 0.6))}px`));

  const w = t.wallpaper.kind !== "default" ? t.wallpaper : themePresets[t.preset].wallpaper ?? t.wallpaper;
  const wallpaper =
    w.kind === "solid" ? w.a!
    : w.kind === "gradient" ? `linear-gradient(${w.angle ?? 135}deg, ${w.a}, ${w.b})`
    : "";
  return { vars, wallpaper };
}

/** set (and clear what is no longer set) a theme's variables on an element (over `base`, the accent palette's); `wallpaper` only where asked (the shell's root) */
export function applyTheme(theme: Theme, el: { style: CSSStyleDeclaration }, opts: { wallpaper?: boolean; base?: Record<string, string> } = {}) {
  const { vars, wallpaper } = themeVars(theme);
  for (const k of themeVarNames) el.style.removeProperty(k);
  for (const [k, v] of Object.entries({ ...opts.base, ...vars })) el.style.setProperty(k, v); // `base`: the accent palette, under the theme
  if (opts.wallpaper) wallpaper ? el.style.setProperty(WALLPAPER_VAR, wallpaper) : el.style.removeProperty(WALLPAPER_VAR);
}
