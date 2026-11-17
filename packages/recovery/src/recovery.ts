// The recovery page: what the kiosk shows when the desktop's own server can't be reached, with a few tools to bring it back.
// It runs as a separate service from the shell, from the pristine copy in the Nix store, so a broken (or edited) desktop can't take it down.
// Actions are a fixed set of names; the commands behind them come from the image's environment, never from a request.

export const ACTIONS = ["restart", "safe", "reset", "reboot", "logs"] as const;
export type Action = (typeof ACTIONS)[number];
export type Commands = Record<Action, string[]>;

export type RecoveryOptions = {
  port: number;
  commands: Partial<Commands>;
  /** the desktop's address, probed for /status */
  uiUrl: string;
  audit: (event: string, outcome: "allow" | "deny" | "info", actor: Record<string, unknown>, detail?: Record<string, unknown>) => void;
  /** starts a command and does not wait (restart, reset, safe, reboot) */
  start?: (argv: string[]) => void;
  /** runs a command and returns its output, bounded (logs) */
  read?: (argv: string[]) => Promise<string>;
  probe?: (url: string) => Promise<boolean>;
};

const LABELS: Record<Action, { title: string; text: string; danger?: string }> = {
  restart: { title: "Restart the desktop", text: "Starts the desktop again. Fixes most hangs. Nothing is lost." },
  safe: { title: "Use the safe desktop", text: "Starts the original, unedited desktop that came with this version, for when your copy is broken." },
  reset: {
    title: "Start from a clean copy",
    text: "Throws away your edited copy of the desktop and makes a new one from this version. Your files and accounts are kept.",
    danger: "This removes changes you made to the desktop's own code. Continue?",
  },
  reboot: { title: "Restart the computer", text: "Restarts the whole computer.", danger: "Restart the computer now?" },
  logs: { title: "Show details", text: "Shows the latest messages from the desktop, to see what went wrong." },
};

export function page(commands: Partial<Commands>) {
  const buttons = ACTIONS.filter((a) => commands[a])
    .map((a) => `<button data-a="${a}" data-c="${LABELS[a].danger ?? ""}"><b>${LABELS[a].title}</b><span>${LABELS[a].text}</span></button>`)
    .join("");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BrasOS · Recovery</title>
<style>
:root{color-scheme:dark;--bg:#0e1411;--card:#17201a;--line:#2a3a2f;--fg:#e8efe9;--dim:#9db0a2;--ok:#3ecf72}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{width:min(680px,92vw);padding:28px 0}h1{margin:0 0 6px;font-size:26px}p{margin:0 0 16px;color:var(--dim)}
#st{display:inline-flex;gap:8px;align-items:center;margin-bottom:18px}#st i{width:10px;height:10px;border-radius:50%;background:#e5a93a}#st.up i{background:var(--ok)}
.grid{display:grid;gap:10px}button{all:unset;cursor:pointer;display:grid;gap:2px;padding:14px 16px;border:1px solid var(--line);border-radius:12px;background:var(--card)}
button:hover,button:focus-visible{border-color:var(--ok)}button span{color:var(--dim);font-size:14px}button[disabled]{opacity:.5;pointer-events:none}
pre{margin:14px 0 0;padding:12px;max-height:40vh;overflow:auto;background:#0a0f0c;border:1px solid var(--line);border-radius:10px;font:12px/1.4 ui-monospace,monospace;white-space:pre-wrap}
small{display:block;margin-top:14px;color:var(--dim)}
</style>
<main><h1>BrasOS can't reach its desktop</h1>
<p>The desktop's server isn't answering. This page keeps working on its own, so you can bring it back. It returns to the desktop by itself as soon as it is up.</p>
<div id="st"><i></i><span id="stt">Checking…</span></div>
<div class="grid">${buttons}</div><pre id="out" hidden></pre>
<small>Waiting a minute often helps: after an update the first start can be slow.</small></main>
<script>
const $=(s)=>document.querySelector(s),out=$("#out");
async function st(){try{const r=await(await fetch("/status")).json();$("#st").className=r.up?"up":"";$("#stt").textContent=r.up?"The desktop is back. Opening it…":"The desktop is not answering.";}catch{}}
setInterval(st,2000);st();
for(const b of document.querySelectorAll("button")){b.onclick=async()=>{
  if(b.dataset.c&&!confirm(b.dataset.c))return;
  b.disabled=true;out.hidden=false;out.textContent="Working…";
  try{const r=await fetch("/do/"+b.dataset.a,{method:"POST"});out.textContent=await r.text();}catch(e){out.textContent="Could not ask for that: "+e;}
  setTimeout(()=>b.disabled=false,3000);};}
</script></html>`;
}

export function createRecovery(o: RecoveryOptions) {
  const probe = o.probe ?? ((u) => fetch(u, { signal: AbortSignal.timeout(1500) }).then((r) => r.status < 500, () => false));
  const text = (s: string, status = 200, type = "text/plain; charset=utf-8") => new Response(s, { status, headers: { "content-type": type, "cache-control": "no-store" } });

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    // contract 3: only localhost names (a DNS-rebinding page can't reach this)
    if (!/^(localhost|[a-z0-9-]+\.localhost)$/.test(url.hostname)) return text("forbidden", 403);
    if (req.method === "GET" && url.pathname === "/") return text(page(o.commands), 200, "text/html; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/status") return text(JSON.stringify({ up: await probe(o.uiUrl) }), 200, "application/json");

    const m = /^\/do\/(\w+)$/.exec(url.pathname);
    if (req.method === "POST" && m) {
      const action = m[1] as Action;
      // a browser sets Origin on a POST; only this page itself (never another site or app) may ask
      const origin = req.headers.get("origin");
      if (origin !== `http://localhost:${o.port}`) {
        o.audit("recovery.action", "deny", { origin: origin ?? null }, { action: ACTIONS.includes(action) ? action : "unknown", reason: "origin" });
        return text("forbidden", 403);
      }
      const argv = ACTIONS.includes(action) ? o.commands[action] : undefined;
      if (!argv) {
        o.audit("recovery.action", "deny", { origin }, { action: ACTIONS.includes(action) ? action : "unknown", reason: "unavailable" });
        return text("not available", 404);
      }
      o.audit("recovery.action", "allow", { origin }, { action });
      if (action === "logs") return text((await (o.read ?? readCommand)(argv)) || "(nothing to show)");
      (o.start ?? startCommand)(argv);
      return text(`Asked: ${LABELS[action].title}. This can take up to a minute.`, 202);
    }
    return text("not found", 404);
  };
}

const startCommand = (argv: string[]) => void Bun.spawn(argv, { stdio: ["ignore", "ignore", "ignore"] });

async function readCommand(argv: string[]) {
  const p = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => p.kill(), 10_000);
  const out = await new Response(p.stdout).text();
  clearTimeout(timer);
  return out.slice(-20_000); // bounded
}
