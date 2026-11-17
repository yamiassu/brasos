// The shell sends "ping" to every window; no "pong" within 8 s shows "isn't responding" (see AGENTS.md, contract 4).
/** F5, Ctrl+R, Ctrl+Shift+R, Ctrl+F5: the keys that reload a page. A reload throws away every open window and unsaved work, so BrasOS does not offer it. */
export const isReloadKey = (e: { key: string; ctrlKey?: boolean; metaKey?: boolean }) => e.key === "F5" || ((!!e.ctrlKey || !!e.metaKey) && e.key.toLowerCase() === "r");

/** F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C: the keys that open Chromium's own devtools (for the whole desktop page). */
export const isDevtoolsKey = (e: { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) =>
  e.key === "F12" || ((!!e.ctrlKey || !!e.metaKey) && !!e.shiftKey && /^[ijc]$/i.test(e.key));

/** the browser's own context menu (Back, Reload, View source, Inspect) over a BrasOS surface: not wanted. Text fields keep theirs (cut, copy, paste). */
export const nativeMenu = (e: { target: any }) => !/^(INPUT|TEXTAREA)$/.test(e.target?.tagName ?? "") && !e.target?.isContentEditable;

export function installHeartbeat(w: any) {
  if (!w.addEventListener || !w.parent || w.parent === w) return;
  // an app's own page, not a website loaded through the gateway (a site keeps its own keys)
  if (!String(w.location?.hostname ?? "").endsWith(".web.localhost")) {
    w.addEventListener("keydown", (e: KeyboardEvent) => isReloadKey(e) && e.preventDefault(), true);
    w.addEventListener("contextmenu", (e: MouseEvent) => nativeMenu(e) && e.preventDefault(), true);
  }
  w.addEventListener("message", (e: MessageEvent) => {
    if (e.source !== w.parent) return;
    if (e.data === "ping") w.parent.postMessage("pong", e.origin);
    else if (e.data?.brasos === "prefs") applyPrefs(w, e.data);
  });
}

const COLOR = /^#[0-9a-fA-F]{3,8}$/;
/** the shell's accent choice: only the three accent variables, only plain colors, so a message can't inject styles */
export function applyPrefs(w: any, m: { vars?: Record<string, string> }) {
  const root = w.document?.documentElement;
  for (const k of ["--accent", "--accent-2", "--on-accent"]) {
    const v = m.vars?.[k];
    if (!root) return;
    if (typeof v === "string" && COLOR.test(v)) root.style.setProperty(k, v);
    else root.style.removeProperty(k);
  }
}
