import { expect, test } from "bun:test";
import { defaultTheme, themePresets, themeVarNames, themeVars, validateTheme, applyTheme } from "../src/theme";
import { WINDOW_VARS, applyPrefs } from "../../sdk/src/heartbeat";

test("the default theme sets nothing (ui.css stays in charge)", () => {
  expect(themeVars(defaultTheme())).toEqual({ vars: {}, wallpaper: "" });
});

test("a preset sets its variables and its wallpaper; a custom color wins over the preset", () => {
  const t = validateTheme({ preset: "midnight", custom: { accent: "#ff0000" } });
  const { vars, wallpaper } = themeVars(t);
  expect(vars["--bg"]).toBe("#0a1020");
  expect(vars["--accent"]).toBe("#ff0000");
  expect(vars["--on-accent"]).toBe("#ffffff"); // readable text on a dark accent
  expect(wallpaper).toContain("linear-gradient(160deg");
});

test("a light background flips the borders and text to dark-on-light", () => {
  const { vars } = themeVars(validateTheme({ custom: { bg: "#fafafa" } }));
  expect(vars["--text"]).toBe("#1b1b1f");
  expect(vars["--border"]).toBe("#00000018");
});

test("a stored or typed theme can't inject styles: only #rrggbb, bounded numbers, known kinds", () => {
  const t = validateTheme({
    preset: "nope", custom: { accent: "red; background:url(x)", bg: "#12345", text: "#AbCdEf" }, radius: 9999,
    wallpaper: { kind: "gradient", a: "url(javascript:1)", b: "#00ff00", angle: -40 },
  });
  expect(t.preset).toBe("night");
  expect(t.custom).toEqual({ text: "#abcdef" });
  expect(t.radius).toBe(20);
  expect(t.wallpaper).toEqual({ kind: "gradient", a: "#0c0c0d", b: "#00ff00", angle: 0 });
  expect(validateTheme({ wallpaper: { kind: "image", a: "x" } }).wallpaper).toEqual({ kind: "default" });
  expect(validateTheme("garbage")).toEqual(defaultTheme());
});

test("every variable a theme can set is one a window accepts, and every preset only uses those", () => {
  for (const k of themeVarNames) expect(WINDOW_VARS).toContain(k);
  for (const p of Object.values(themePresets)) for (const k of Object.keys(p.vars)) expect(themeVarNames as readonly string[]).toContain(k);
  for (const id of Object.keys(themePresets)) for (const k of Object.keys(themeVars(validateTheme({ preset: id, radius: 4, custom: { bg: "#101010", panel: "#202020", text: "#eeeeee", accent: "#00ff88", accent2: "#8800ff" } })).vars)) expect(WINDOW_VARS).toContain(k);
});

test("applyTheme sets, then clears, the variables (the wallpaper only where asked)", () => {
  const el = { style: new Map<string, string>() as any };
  el.style = { props: new Map<string, string>(), setProperty(k: string, v: string) { this.props.set(k, v); }, removeProperty(k: string) { this.props.delete(k); } };
  applyTheme(validateTheme({ preset: "paper", wallpaper: { kind: "solid", a: "#112233" } }), el, { wallpaper: true });
  expect(el.style.props.get("--bg")).toBe("#f2f2ee");
  expect(el.style.props.get("--wallpaper")).toBe("#112233");
  applyTheme(defaultTheme(), el, { wallpaper: true, base: { "--accent": "#e3b36b" } });
  expect([...el.style.props.keys()]).toEqual(["--accent"]); // the palette stays; the theme is gone
});

test("a window ignores anything but plain colors and small pixel sizes", () => {
  const set: Record<string, string> = {};
  const w = { document: { documentElement: { style: { setProperty: (k: string, v: string) => (set[k] = v), removeProperty: (k: string) => delete set[k] } } } };
  applyPrefs(w, { vars: { "--bg": "#101010", "--radius": "12px", "--text": "red; x:y", "--accent": "url(x)", "--radius-sm": "99999px", "--evil": "#fff" } });
  expect(set).toEqual({ "--bg": "#101010", "--radius": "12px" });
});
