// The first-boot installer: welcome, account, region and input, appearance, device, review. Pure UI (it hands the result to `onSubmit`),
// so it can be shown in Storybook. The host validates everything again; these checks only save a round trip.
import { useState, type FormEvent } from "react";
import { applyPalette, Button, Icon, palettes, SelectField, TextField } from "@brasos/ui";

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

export function Setup({ onSubmit }: { onSubmit(form: SetupForm): Promise<string | void> }) {
  const [step, setStep] = useState(0);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<SetupForm>({
    display: "",
    username: "",
    password: "",
    prefs: { language: navigator.language?.startsWith("pt") ? "pt-BR" : "en-US", timezone: guessZone(), keyboard: "us", clock24: true, palette: "amber", deviceName: "brasos" },
  });
  const set = (patch: Partial<SetupForm>) => setF((x) => ({ ...x, ...patch }));
  const pref = (patch: Partial<SetupForm["prefs"]>) => set({ prefs: { ...f.prefs, ...patch } });

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

  return (
    <div className="setup">
      <form className="setup-card" onSubmit={next} aria-label="First-time setup">
        <ol className="setup-steps" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s} aria-current={i === step ? "step" : undefined} className={i < step ? "done" : undefined}>{s}</li>
          ))}
        </ol>
        <div className="setup-body">
          {step === 0 && (
            <>
              <h1>Welcome to BrasOS</h1>
              <p>A few questions to set up this computer: who uses it, where it is, and how it should look. It takes a minute, and everything can be changed later.</p>
              <p className="muted">This system is an early foundation, not a certified product.</p>
            </>
          )}
          {step === 1 && (
            <>
              <h1>Your account</h1>
              <TextField label="Full name" autoFocus value={f.display} onChange={(e) => set({ display: e.target.value })} autoComplete="name" />
              <TextField label="Username" value={f.username} onChange={(e) => set({ username: e.target.value.toLowerCase() })} autoComplete="username" />
              <TextField label="Password (at least 10 characters)" type="password" value={f.password} onChange={(e) => set({ password: e.target.value })} autoComplete="new-password" />
              <TextField label="Repeat the password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
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
              <p>BrasOS is dark and neutral. Pick the one color that marks focus and selection.</p>
              <div role="radiogroup" aria-label="Accent color" className="setup-choices">
                {Object.entries(palettes).map(([id, p]) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={f.prefs.palette === id}
                    className="setup-choice"
                    onClick={() => (pref({ palette: id }), applyPalette(id, document.documentElement))}
                  >
                    <span className="swatch" style={{ background: id === "amber" ? "#e3b36b" : p.vars["--accent"] }} />
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
              <dl className="setup-review">
                <dt>Account</dt><dd>{f.display} ({f.username})</dd>
                <dt>Language</dt><dd>{f.prefs.language}</dd>
                <dt>Time zone</dt><dd>{f.prefs.timezone}</dd>
                <dt>Keyboard</dt><dd>{f.prefs.keyboard}</dd>
                <dt>Clock</dt><dd>{f.prefs.clock24 ? "24-hour" : "12-hour"}</dd>
                <dt>Accent</dt><dd>{(palettes as any)[f.prefs.palette]?.label}</dd>
                <dt>Device</dt><dd>{f.prefs.deviceName}</dd>
              </dl>
            </>
          )}
          {error && <p role="alert" className="setup-error">{error}</p>}
        </div>
        <div className="setup-actions">
          {step > 0 && <Button onClick={() => (setError(""), setStep(step - 1))}>Back</Button>}
          <span className="grow" />
          <Button variant="primary" type="submit" disabled={busy} autoFocus={step === 0 || step === 3 || step === 5}>
            {step === STEPS.length - 1 ? (busy ? "Setting up…" : "Finish") : "Continue"}
          </Button>
        </div>
      </form>
    </div>
  );
}

/** the lock screen: the account's name and a password */
export function Login({ display, onSubmit }: { display: string; onSubmit(password: string): Promise<string | void> }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="setup">
      <form
        className="login-card"
        aria-label="Unlock"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const err = await onSubmit(pw);
          setBusy(false);
          if (err) (setError(err), setPw(""));
        }}
      >
        <div className="avatar" aria-hidden="true"><Icon name="user" size={36} /></div>
        <h1>{display}</h1>
        <TextField label="Password" type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
        {error && <p role="alert" className="setup-error">{error}</p>}
        <Button variant="primary" type="submit" disabled={busy || !pw}>Unlock</Button>
      </form>
    </div>
  );
}
