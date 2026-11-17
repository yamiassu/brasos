// The first-boot installer (welcome, account, region and input, appearance, device, review) and the lock screen. Pure UI (they hand the
// result to `onSubmit`), so they can be shown in Storybook. The host validates everything again; these checks only save a round trip.
import { useEffect, useState, type FormEvent } from "react";
import { applyPalette, BrandMark, Button, palettes, SelectField, TextField } from "@brasos/ui";

export type SetupForm = {
  display: string;
  username: string;
  password: string;
  prefs: { language: string; timezone: string; keyboard: string; clock24: boolean; palette: string; deviceName: string };
};

const STEPS = ["Welcome", "Account", "Region", "Appearance", "Device", "Review"] as const;
const zones = [...Intl.supportedValuesOf("timeZone"), "UTC"];
const guessZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** what is wrong with the account fields, or "" */
export function accountProblem(f: { display: string; username: string; password: string }, confirm: string): string {
  if (!f.display.trim()) return "Enter your name.";
  if (!/^[a-z][a-z0-9_-]{2,31}$/.test(f.username)) return "The username needs 3 to 32 lowercase letters, digits, - or _, starting with a letter.";
  if (f.password.length < 10) return "The password needs at least 10 characters.";
  if (f.password.toLowerCase().includes(f.username) || new Set(f.password).size < 4) return "That password is too easy to guess.";
  if (f.password !== confirm) return "The passwords don't match.";
  return "";
}

/** 0 (empty) to 4, a hint for the person typing; the real rules are in accountProblem and on the host */
export function passwordStrength(pw: string): number {
  if (!pw) return 0;
  let n = pw.length >= 10 ? 1 : 0;
  if (pw.length >= 14) n++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) n++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) n++;
  return Math.max(n, pw.length ? 1 : 0) as number;
}
const STRENGTH = ["", "Weak", "Fair", "Good", "Strong"];

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";

export function Setup({ onSubmit }: { onSubmit(form: SetupForm): Promise<string | void> }) {
  const [step, setStep] = useState(0);
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<SetupForm>({
    display: "",
    username: "",
    password: "",
    prefs: { language: navigator.language?.startsWith("pt") ? "pt-BR" : "en-US", timezone: guessZone(), keyboard: "us", clock24: true, palette: "green", deviceName: "brasos" },
  });
  const set = (patch: Partial<SetupForm>) => setF((x) => ({ ...x, ...patch }));
  const pref = (patch: Partial<SetupForm["prefs"]>) => set({ prefs: { ...f.prefs, ...patch } });
  const strength = passwordStrength(f.password);

  const problem = (): string => {
    if (step === 1) return accountProblem(f, confirm);
    if (step === 4 && !/^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/.test(f.prefs.deviceName)) return "The device name needs lowercase letters, digits and -, up to 32 characters.";
    return "";
  };
  const next = async (e: FormEvent) => {
    e.preventDefault();
    const p = problem();
    if (p) return setError(p);
    setError("");
    if (step < STEPS.length - 1) return setStep(step + 1);
    setBusy(true);
    const err = await onSubmit(f);
    setBusy(false);
    if (err) setError(err);
  };
  const pw = show ? "text" : "password";

  return (
    <div className="setup">
      <form className="setup-card" onSubmit={next} aria-label="First-time setup">
        <aside className="setup-side">
          <div className="setup-brand"><BrandMark size={34} /><span>BrasOS</span></div>
          <ol className="setup-steps" aria-label="Steps">
            {STEPS.map((s, i) => (
              <li key={s} aria-current={i === step ? "step" : undefined} className={i < step ? "done" : undefined}>
                <span className="dot">{i < step ? "✓" : i + 1}</span>{s}
              </li>
            ))}
          </ol>
          <p className="setup-note">An early foundation, not a certified product.</p>
        </aside>

        <div className="setup-main">
          <div className="setup-progress" role="progressbar" aria-label="Setup progress" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1}><i style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>
          <div className="setup-body">
            <p className="eyebrow">Step {step + 1} of {STEPS.length}</p>
            {step === 0 && (
              <>
                <h1>Welcome to BrasOS</h1>
                <p className="lead">A few questions to set up this computer: who uses it, where it is, and how it should look.</p>
                <p className="muted">It takes about a minute, and everything can be changed later.</p>
              </>
            )}
            {step === 1 && (
              <>
                <h1>Your account</h1>
                <TextField label="Full name" autoFocus value={f.display} onChange={(e) => set({ display: e.target.value })} autoComplete="name" />
                <TextField label="Username" value={f.username} onChange={(e) => set({ username: e.target.value.toLowerCase() })} autoComplete="username" />
                <TextField label="Password (at least 10 characters)" type={pw} value={f.password} onChange={(e) => set({ password: e.target.value })} autoComplete="new-password" />
                <div className="strength" aria-live="polite">
                  <span className={`bars s${strength}`} aria-hidden="true"><i /><i /><i /><i /></span>
                  <span>{STRENGTH[strength]}</span>
                  <button type="button" className="linkish" onClick={() => setShow(!show)}>{show ? "Hide" : "Show"} passwords</button>
                </div>
                <TextField label="Repeat the password" type={pw} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
                <p className="muted">The password locks this screen. It does not encrypt the disk.</p>
              </>
            )}
            {step === 2 && (
              <>
                <h1>Region and input</h1>
                <SelectField label="Language" value={f.prefs.language} onChange={(e) => pref({ language: e.target.value })}>
                  <option value="pt-BR">Português (Brasil)</option>
                  <option value="en-US">English (US)</option>
                </SelectField>
                <SelectField label="Time zone" value={f.prefs.timezone} onChange={(e) => pref({ timezone: e.target.value })}>
                  {zones.map((z) => <option key={z}>{z}</option>)}
                </SelectField>
                <SelectField label="Keyboard layout" value={f.prefs.keyboard} onChange={(e) => pref({ keyboard: e.target.value })}>
                  <option value="br-abnt2">Portuguese (Brazil, ABNT2)</option>
                  <option value="us">English (US)</option>
                  <option value="us-intl">English (US, international)</option>
                </SelectField>
                <SelectField label="Clock" value={f.prefs.clock24 ? "24" : "12"} onChange={(e) => pref({ clock24: e.target.value === "24" })}>
                  <option value="24">24-hour</option>
                  <option value="12">12-hour</option>
                </SelectField>
              </>
            )}
            {step === 3 && (
              <>
                <h1>Appearance</h1>
                <p className="lead">BrasOS is dark and neutral. Pick the pair of colors that marks focus and selection.</p>
                <div role="radiogroup" aria-label="Colors" className="setup-choices">
                  {Object.entries(palettes).map(([id, p]) => (
                    <button key={id} type="button" role="radio" aria-checked={f.prefs.palette === id} className="setup-choice" onClick={() => (pref({ palette: id }), applyPalette(id, document.documentElement))}>
                      <span className="pair"><i style={{ background: p.swatch[0] }} /><i style={{ background: p.swatch[1] }} /></span>
                      {p.label}
                    </button>
                  ))}
                </div>
              </>
            )}
            {step === 4 && (
              <>
                <h1>This device</h1>
                <TextField label="Device name" autoFocus value={f.prefs.deviceName} onChange={(e) => pref({ deviceName: e.target.value.toLowerCase() })} />
                <p className="muted">Used to identify this computer on a network and in audit records.</p>
              </>
            )}
            {step === 5 && (
              <>
                <h1>Ready</h1>
                <div className="setup-who"><span className="avatar" aria-hidden="true">{initials(f.display)}</span><div><b>{f.display}</b><small>{f.username}</small></div></div>
                <dl className="setup-review">
                  <dt>Language</dt><dd>{f.prefs.language}</dd>
                  <dt>Time zone</dt><dd>{f.prefs.timezone}</dd>
                  <dt>Keyboard</dt><dd>{f.prefs.keyboard}</dd>
                  <dt>Clock</dt><dd>{f.prefs.clock24 ? "24-hour" : "12-hour"}</dd>
                  <dt>Colors</dt><dd>{(palettes as any)[f.prefs.palette]?.label}</dd>
                  <dt>Device</dt><dd>{f.prefs.deviceName}</dd>
                </dl>
              </>
            )}
            {error && <p role="alert" className="setup-error">{error}</p>}
          </div>
          <div className="setup-actions">
            {step > 0 && <Button onClick={() => (setError(""), setStep(step - 1))}>Back</Button>}
            <span className="grow" />
            <Button key={step} variant="primary" type="submit" disabled={busy} autoFocus={step === 0 || step === 3 || step === 5}>
              {step === STEPS.length - 1 ? (busy ? "Setting up…" : "Finish") : "Continue"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

/** the lock screen: the time, the account's name and a password. It locks the screen; it is not access control to the machine. */
export function Login({ display, hasPin, others, onSwitch, onSubmit }: { display: string; hasPin?: boolean; others?: { username: string; display: string }[]; onSwitch?(username: string): void; onSubmit(secret: string, kind: "password" | "pin"): Promise<string | void> }) {
  const [usePin, setUsePin] = useState(!!hasPin);
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="setup lock">
      <div className="lock-clock" aria-hidden="true">
        <div className="time">{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
        <div className="date">{now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</div>
      </div>
      <form
        key={shake}
        className={`login-card${shake ? " shake" : ""}`}
        aria-label="Unlock"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const err = await onSubmit(pw, usePin ? "pin" : "password");
          setBusy(false);
          if (err) (setError(err), setPw(""), setShake((n) => n + 1));
        }}
      >
        <div className="avatar" aria-hidden="true">{initials(display)}</div>
        <h1>{display}</h1>
        <div className="field-row">
          {usePin
            ? <TextField label="PIN" type="password" inputMode="numeric" maxLength={8} autoFocus value={pw} onChange={(e) => setPw(e.target.value.replace(/\D/g, ""))} autoComplete="off" />
            : <TextField label="Password" type={show ? "text" : "password"} autoFocus value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />}
          {!usePin && <button type="button" className="eye" aria-pressed={show} onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button>}
        </div>
        {error && <p role="alert" className="setup-error">{error}</p>}
        <Button variant="primary" type="submit" disabled={busy || !pw}>{busy ? "Unlocking…" : "Unlock"}</Button>
        {hasPin && <button type="button" className="eye" onClick={() => (setUsePin(!usePin), setPw(""), setError(""))}>{usePin ? "Use the password instead" : "Use the PIN instead"}</button>}
        {!!others?.length && (
          <div className="field-row" role="group" aria-label="Other accounts" style={{ flexWrap: "wrap", justifyContent: "center", gap: 8 }}>
            {others.map((o) => <button key={o.username} type="button" className="eye" onClick={() => onSwitch?.(o.username)}>{o.display}</button>)}
          </div>
        )}
        <p className="setup-note">This locks the screen. It does not encrypt the disk.</p>
      </form>
    </div>
  );
}
