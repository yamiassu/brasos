import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { os } from "@brasos/sdk";
import { applyTheme, defaultTheme, palettes, themeVars, validateTheme, type Theme } from "@brasos/ui";
import "@brasos/ui/ui.css";
import "./shell.css";
import "./user.css"; // last on purpose: user overrides win
import { Shell } from "./shell";
import { Login, Setup, type SetupForm } from "./setup";

type Who = { username: string; display: string; hasPin?: boolean };
type State = { available: boolean; done: boolean; user?: { username: string; display: string }; accounts?: Who[]; prefs?: SetupForm["prefs"]; devSkip?: boolean; hasPin?: boolean };
const post = (path: string, body: unknown) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const KEY = "brasos.unlocked"; // per tab session; this is a screen lock, not access control (see the security guide)
const was = () => { try { return sessionStorage.getItem(KEY) === "1"; } catch { return false; } };
const remember = (on: boolean) => { try { on ? sessionStorage.setItem(KEY, "1") : sessionStorage.removeItem(KEY); } catch {} };
const WHO = "brasos.who"; // which account is signed in (a name only), so a reload of the tab stays on it
const savedWho = () => { try { return sessionStorage.getItem(WHO) ?? ""; } catch { return ""; } };

// First boot: the installer. Then a lock screen. Then the desktop. Without a state directory there is no account to ask for.
function Root() {
  const [st, setSt] = useState<State | null>(null);
  const [unlocked, setUnlocked] = useState(was);
  const [who, setWho] = useState(savedWho); // the account shown on the lock screen / signed in; empty means the owner
  const [theme, setTheme] = useState<Theme>(defaultTheme);
  // the theme (Settings → Theme) lives in the shared database; follow it live
  useEffect(() => {
    const col = os.db.collection("theme", { space: "shared" });
    col.get("current").then((r) => setTheme(validateTheme(r.doc))).catch(() => {});
    return col.watch((e) => e.id === "current" && setTheme(e.op === "put" ? validateTheme(e.doc) : defaultTheme()));
  }, []);
  const palette = (palettes as Record<string, { vars: Record<string, string> }>)[st?.prefs?.palette ?? ""]?.vars ?? {};
  const windowVars = useMemo(() => ({ ...palette, ...themeVars(theme).vars }), [theme, st?.prefs?.palette]);
  useEffect(() => {
    applyTheme(theme, document.documentElement, { wallpaper: true, base: palette });
  }, [theme, st?.prefs?.palette]);
  const load = () => fetch("/os/setup").then((r) => r.json()).then(setSt).catch(() => setSt({ available: false, done: true }));
  useEffect(() => void load(), []);
  useEffect(() => {
    if (!st?.prefs) return;
    document.documentElement.lang = st.prefs.language;
  }, [st]);
  if (!st) return null;
  const accounts = st.accounts ?? (st.user ? [{ ...st.user, hasPin: st.hasPin }] : []);
  const me = accounts.find((a) => a.username === who) ?? accounts[0] ?? (st.user && { ...st.user, hasPin: st.hasPin }); // a removed account falls back to the owner
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
  if (st.available && st.done && !unlocked && !st.devSkip) {
    return (
      <div className="ui-root">
        <Login
          key={me!.username}
          display={me!.display}
          hasPin={me!.hasPin}
          others={accounts.filter((a) => a.username !== me!.username)}
          onSwitch={setWho}
          onSubmit={async (secret, kind) => {
            const r = await post("/os/login", { username: me!.username, ...(kind === "pin" ? { pin: secret } : { password: secret }) });
            if (!r.ok) return (await r.json().catch(() => ({}))).error ?? "could not unlock";
            try { sessionStorage.setItem(WHO, me!.username); } catch {}
            remember(true);
            setUnlocked(true);
          }}
        />
      </div>
    );
  }
  return <Shell prefs={st.prefs} user={me} username={me?.username} hasPin={me?.hasPin} onPinChanged={load} windowVars={windowVars} onLock={st.available && st.done && !st.devSkip ? () => (remember(false), setUnlocked(false)) : undefined} />;
}

createRoot(document.getElementById("root")!).render(<Root />);
