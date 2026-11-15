import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { applyPalette } from "@brasos/ui";
import "@brasos/ui/ui.css";
import "./shell.css";
import "./user.css"; // last on purpose: user overrides win
import { Shell } from "./shell";
import { Login, Setup, type SetupForm } from "./setup";

type State = { available: boolean; done: boolean; user?: { username: string; display: string }; prefs?: SetupForm["prefs"] };
const post = (path: string, body: unknown) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const KEY = "brasos.unlocked"; // per tab session; this is a screen lock, not access control (see the security guide)
const was = () => { try { return sessionStorage.getItem(KEY) === "1"; } catch { return false; } };
const remember = (on: boolean) => { try { on ? sessionStorage.setItem(KEY, "1") : sessionStorage.removeItem(KEY); } catch {} };

// First boot: the installer. Then a lock screen. Then the desktop. Without a state directory there is no account to ask for.
function Root() {
  const [st, setSt] = useState<State | null>(null);
  const [unlocked, setUnlocked] = useState(was);
  const load = () => fetch("/os/setup").then((r) => r.json()).then(setSt).catch(() => setSt({ available: false, done: true }));
  useEffect(() => void load(), []);
  useEffect(() => {
    if (!st?.prefs) return;
    applyPalette(st.prefs.palette, document.documentElement);
    document.documentElement.lang = st.prefs.language;
  }, [st]);
  if (!st) return null;
  if (st.available && !st.done) {
    return (
      <div className="ui-root">
        <Setup
          onSubmit={async (f) => {
            const r = await post("/os/setup/complete", f);
            if (!r.ok) return (await r.json().catch(() => ({}))).error ?? `failed (${r.status})`;
            remember(true);
            setUnlocked(true);
            await load();
          }}
        />
      </div>
    );
  }
  if (st.available && st.done && !unlocked) {
    return (
      <div className="ui-root">
        <Login
          display={st.user!.display}
          onSubmit={async (password) => {
            const r = await post("/os/login", { username: st.user!.username, password });
            if (!r.ok) return (await r.json().catch(() => ({}))).error ?? "could not unlock";
            remember(true);
            setUnlocked(true);
          }}
        />
      </div>
    );
  }
  return <Shell prefs={st.prefs} user={st.user} onLock={st.available && st.done ? () => (remember(false), setUnlocked(false)) : undefined} />;
}

createRoot(document.getElementById("root")!).render(<Root />);
