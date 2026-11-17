// The shell sends "ping" to every window; no "pong" within 8 s shows "isn't responding" (see AGENTS.md, contract 4).
import { capture, requestedSize } from "./snapshot";

/** F5, Ctrl+R, Ctrl+Shift+R, Ctrl+F5: the keys that reload a page. A reload throws away every open window and unsaved work, so BrasOS does not offer it. */
export const isReloadKey = (e: { key: string; ctrlKey?: boolean; metaKey?: boolean }) => e.key === "F5" || ((!!e.ctrlKey || !!e.metaKey) && e.key.toLowerCase() === "r");

/** F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C: the keys that open Chromium's own devtools (for the whole desktop page). */
export const isDevtoolsKey = (e: { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) =>
  e.key === "F12" || ((!!e.ctrlKey || !!e.metaKey) && !!e.shiftKey && /^[ijc]$/i.test(e.key));

/** the browser's own context menu (Back, Reload, View source, Inspect) over a BrasOS surface: not wanted. Text fields keep theirs (cut, copy, paste). */
export const nativeMenu = (e: { target: any }) => !/^(INPUT|TEXTAREA)$/.test(e.target?.tagName ?? "") && !e.target?.isContentEditable;
/** whether the shell shows this window maximized (the shell tells us), so an app's own window buttons can show the right icon */

/** Alt+Tab (and nothing else with it) */
export const isSwitchKey = (e: { key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => e.key === "Tab" && !!e.altKey && !e.ctrlKey && !e.metaKey;

export const windowState = { max: false, subs: new Set<(max: boolean) => void>() };

export function installHeartbeat(w: any) {
  if (!w.addEventListener || !w.parent || w.parent === w) return;
  // an app's own page, not a website loaded through the gateway (a site keeps its own keys)
  if (!String(w.location?.hostname ?? "").endsWith(".web.localhost")) {
    w.addEventListener("keydown", (e: KeyboardEvent) => isReloadKey(e) && e.preventDefault(), true);
    w.addEventListener("contextmenu", (e: MouseEvent) => nativeMenu(e) && e.preventDefault(), true);
  }
  // The window switcher (Alt+Tab) lives in the shell, but the keys go to whatever has the focus: this window forwards them. The message
  // carries no data beyond the phase, and the shell only acts on it as a focus change among its own windows.
  const shell = `${w.location?.protocol ?? "http:"}//localhost${w.location?.port ? ":" + w.location.port : ""}`;
  let switching = false;
  const tell = (phase: "next" | "end" | "cancel", shift = false) => w.parent.postMessage({ brasos: "switch", phase, shift }, shell);
  w.addEventListener("keydown", (e: KeyboardEvent) => {
    if (isSwitchKey(e)) (e.preventDefault(), (switching = true), tell("next", e.shiftKey));
    else if (switching && e.key === "Escape") (e.preventDefault(), (switching = false), tell("cancel"));
  }, true);
  w.addEventListener("keyup", (e: KeyboardEvent) => {
    if (switching && e.key === "Alt") (switching = false, tell("end"));
  }, true);
  // a click in the window while the switcher is open dismisses it (the shell never sees clicks that land in a frame)
  w.addEventListener("pointerdown", () => switching && ((switching = false), tell("cancel")), true);
  // The window switcher's thumbnail: the shell asks, the window draws itself (snapshot.ts) and answers with a small JPEG. Only an app's own
  // page does: a website loaded through the gateway is never copied.
  const isSite = String(w.location?.hostname ?? "").endsWith(".web.localhost");
  let drawing = false;
  w.addEventListener("message", (e: MessageEvent) => {
    if (e.source !== w.parent) return;
    if (e.data === "ping") w.parent.postMessage("pong", e.origin);
    else if (e.data?.brasos === "snapshot-request" && !isSite && !drawing) {
      const size = requestedSize(e.data, { w: w.innerWidth ?? 0, h: w.innerHeight ?? 0 });
      if (!size) return;
      drawing = true;
      void capture(size, w).then((r) => (drawing = false, r && w.parent.postMessage({ brasos: "snapshot", w: r.w, h: r.h, url: r.url }, shell)));
    }
    else if (e.data?.brasos === "prefs") applyPrefs(w, e.data);
    else if (e.data?.brasos === "window-state" && typeof e.data.max === "boolean") (windowState.max = e.data.max, windowState.subs.forEach((f) => f(windowState.max)));
  });
}

const COLOR = /^#[0-9a-fA-F]{3,8}$/;
const PX = /^\d{1,2}px$/;
/** the variables a window may take from the shell: the accent palette and the theme (packages/ui/src/theme.ts; a test keeps them equal) */
export const WINDOW_VARS = [
  "--bg", "--panel", "--panel-2", "--text", "--muted", "--icon", "--icon-hi", "--border", "--border-strong", "--hover", "--selected",
  "--accent", "--accent-2", "--on-accent", "--radius", "--radius-sm",
];
/** the shell's palette and theme: only those variables, only plain colors or small pixel sizes, so a message can't inject styles */
export function applyPrefs(w: any, m: { vars?: Record<string, string> }) {
  const root = w.document?.documentElement;
  if (!root) return;
  for (const k of WINDOW_VARS) {
    const v = m.vars?.[k];
    if (typeof v === "string" && (k.startsWith("--radius") ? PX : COLOR).test(v)) root.style.setProperty(k, v);
    else root.style.removeProperty(k);
  }
}
