// Import from every app. Answers the shell's heartbeat so it can tell "hung" from "alive".
addEventListener("message", (e) => {
  if (e.source === parent && e.data === "ping") parent.postMessage("pong", e.origin);
});
