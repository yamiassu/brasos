// The shell sends "ping" to every window; no "pong" within 8 s shows "isn't responding" (see AGENTS.md, contract 4).
export function installHeartbeat(w: any) {
  if (!w.addEventListener || !w.parent || w.parent === w) return;
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
