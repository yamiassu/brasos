// The shell sends "ping" to every window; no "pong" within 8 s shows "isn't responding" (see AGENTS.md, contract 4).
export function installHeartbeat(w: any) {
  if (!w.addEventListener || !w.parent || w.parent === w) return;
  w.addEventListener("message", (e: MessageEvent) => {
    if (e.source === w.parent && e.data === "ping") w.parent.postMessage("pong", e.origin);
  });
}
