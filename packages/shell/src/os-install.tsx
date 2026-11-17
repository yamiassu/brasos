// The OS installer: choose the drive, see the layout, confirm the erase, watch it install. Same look as the first-boot setup
// (they are the two halves of getting a machine going), pure UI: it hands the plan to `run`, which does the work and reports
// progress. The host slice that would really partition a disk does not exist yet; Storybook runs it with a simulated `run`.
import { useState, type FormEvent } from "react";
import { BrandMark, Button, Icon, SelectField, TextField } from "@brasos/ui";
import { busName, CONFIRM_WORD, confirmed, describeDisk, diskProblem, friendly, hasData, layoutFor, size, type Disk, type Part, type Plan } from "./os-install-model";

const STEPS = ["Drive", "Layout", "Review", "Install"] as const;
export const PHASES = ["Preparing the drive", "Setting up storage", "Copying BrasOS", "Making the computer start BrasOS", "Finishing up"] as const;
const COLORS = ["var(--accent-2)", "#6cb6ff", "#ffb454", "#ff8fb1", "var(--accent)"];

/** a drive drawn as one bar of its partitions, with a legend */
function PartBar({ parts, total, labelled = true }: { parts: { label: string; sizeGB: number }[]; total: number; labelled?: boolean }) {
  return (
    <div className="partbar">
      <div className="bar" role="img" aria-label={parts.length ? parts.map((p) => `${p.label} ${size(p.sizeGB)}`).join(", ") : "Empty"}>
        {parts.map((p, i) => <i key={i} style={{ flex: p.sizeGB, background: COLORS[i % COLORS.length] }} title={`${p.label} · ${size(p.sizeGB)}`} />)}
      </div>
      {labelled && (
        <ul>
          {parts.map((p, i) => <li key={i}><i style={{ background: COLORS[i % COLORS.length] }} />{p.label}<small>{size(p.sizeGB)}</small></li>)}
          {!parts.length && <li className="none">Empty</li>}
        </ul>
      )}
    </div>
  );
}

export function OsInstall({ disks, run, onRestart, filesystems = ["ext4", "btrfs"] }: {
  disks: Disk[];
  /** the file systems the system image can be installed on (the live image's prebuilt system is ext4 only) */
  filesystems?: Plan["fs"][];
  /** do the install; call `report(phase, percent)` as it goes; resolve with an error message if it failed */
  run(disk: Disk, plan: Plan, report: (phase: number, percent: number) => void): Promise<string | void>;
  onRestart(): void;
}) {
  const [step, setStep] = useState(0);
  const [diskId, setDiskId] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan>({ swapGB: 4, fs: "ext4" });
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<{ phase: number; percent: number } | null>(null);
  const [done, setDone] = useState(false);

  const disk = disks.find((d) => d.id === diskId) ?? null;
  const layout: Part[] = disk ? layoutFor(disk, plan) : [];
  const installing = step === 3;

  const problem = () => (step === 0 && !disk ? "Choose the drive to install on." : step === 2 && !confirmed(typed) ? `Type ${CONFIRM_WORD} to confirm.` : "");
  const next = async (e: FormEvent) => {
    e.preventDefault();
    const p = problem();
    if (p) return setError(p);
    setError("");
    if (step < 2) return setStep(step + 1);
    // step 2 -> install
    setStep(3);
    setProgress({ phase: 0, percent: 0 });
    const err = await run(disk!, plan, (phase, percent) => setProgress({ phase, percent }));
    if (err) { setError(err); setStep(2); setProgress(null); } else setDone(true);
  };

  return (
    <div className="setup">
      <form className="setup-card os-install" onSubmit={next} aria-label="Install BrasOS">
        <aside className="setup-side">
          <div className="setup-brand"><BrandMark size={34} /><span>Install</span></div>
          <ol className="setup-steps" aria-label="Steps">
            {STEPS.map((s, i) => (
              <li key={s} aria-current={i === step ? "step" : undefined} className={i < step || done ? "done" : undefined}>
                <span className="dot">{i < step || done ? "✓" : i + 1}</span>{s}
              </li>
            ))}
          </ol>
          <p className="setup-note">Nothing is changed on any drive until you confirm on the Review step.</p>
        </aside>

        <div className="setup-main">
          <div className="setup-progress" role="progressbar" aria-label="Install progress" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={done ? STEPS.length : step + 1}><i style={{ width: `${(done ? 1 : (step + 1) / STEPS.length) * 100}%` }} /></div>
          <div className="setup-body">
            <p className="eyebrow">{done ? "Finished" : `Step ${step + 1} of ${STEPS.length}`}</p>

            {step === 0 && (
              <>
                <h1>Where should BrasOS go?</h1>
                <p className="lead">Choose the drive to install on. BrasOS uses the whole drive, so anything already on it will be erased, and you will be asked to confirm before anything happens.</p>
                <div role="radiogroup" aria-label="Drives" className="disks">
                  {disks.map((d) => {
                    const why = diskProblem(d);
                    const found = describeDisk(d);
                    return (
                      <button key={d.id} type="button" role="radio" aria-checked={diskId === d.id} disabled={!!why} className="disk" onClick={() => setDiskId(d.id)}>
                        <Icon name="disk" size={26} />
                        <div className="what">
                          <b>{d.model}</b>
                          <small>{busName(d.bus)} · {size(d.sizeGB)} <span className="muted">({d.path})</span></small>
                          <PartBar parts={d.parts.map((p) => ({ ...p, label: friendly(p) }))} total={d.sizeGB} labelled={false} />
                          {!why && <small className={found.systems.length ? "found warn" : "found"} title="A best guess from how the drive is set up. Nothing on it was opened.">{found.summary}</small>}
                        </div>
                        <span className={`pill ${why ? "off" : hasData(d) ? "warn" : "ok"}`}>{why || (hasData(d) ? "Has data" : "Empty")}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {step === 1 && disk && (
              <>
                <h1>Layout</h1>
                <p className="lead">The whole drive is used for BrasOS. This is how {disk.model} will be set up. The suggested choices are fine for most people, so you can just continue.</p>
                <div role="radiogroup" aria-label="Install type" className="modes">
                  <button type="button" role="radio" aria-checked className="mode"><b>Erase the drive</b><small>Recommended. Everything on it is removed.</small></button>
                  <button type="button" role="radio" aria-checked={false} className="mode" disabled><b>Install beside another system</b><small>Not available yet.</small></button>
                  <button type="button" role="radio" aria-checked={false} className="mode" disabled><b>Manual partitioning</b><small>Not available yet.</small></button>
                </div>
                <PartBar parts={layout} total={disk.sizeGB} />
                <table className="layout">
                  <thead><tr><th>What it is for</th><th>Size</th><th>Technical</th></tr></thead>
                  <tbody>{layout.map((p) => <tr key={p.id}><td>{p.label}</td><td>{size(p.sizeGB)}</td><td className="mono muted">{p.mount} · {p.fs}</td></tr>)}</tbody>
                </table>
                <div className="opts">
                  {filesystems.length > 1 && (
                    <SelectField label="File system" value={plan.fs} onChange={(e) => setPlan({ ...plan, fs: e.target.value as Plan["fs"] })}>{filesystems.map((f) => <option key={f} value={f}>{f}</option>)}</SelectField>
                  )}
                  <SelectField label="Extra memory (swap)" value={plan.swapGB} onChange={(e) => setPlan({ ...plan, swapGB: +e.target.value })}>{[0, 2, 4, 8, 16].map((g) => <option key={g} value={g}>{g ? `${g} GB` : "None"}</option>)}</SelectField>
                </div>
                <dl className="explain">
                  <dt>File system: {plan.fs}</dt>
                  <dd>The way files are stored and found on the drive, like the filing system of a cabinet. {plan.fs === "ext4" ? "ext4 is the standard, proven choice for Linux-based systems like BrasOS: fast, reliable, and nothing to set up. Windows cannot read it without extra software." : "btrfs adds snapshots and checks for damaged data."}</dd>
                  <dt>Extra memory (swap)</dt>
                  <dd>Spare room on the drive that the computer uses when it runs out of memory (RAM), so programs slow down instead of closing. 4 GB suits most computers; choose more if you have little RAM and run many programs.</dd>
                </dl>
                <p className="muted">Drive encryption is not available yet.</p>
              </>
            )}

            {step === 2 && disk && (
              <>
                <h1>Ready to install</h1>
                <div className="danger-box" role="alert">
                  <Icon name="crash" size={22} />
                  <div><b>Everything on {disk.model} will be erased.</b><small>{hasData(disk) ? `${describeDisk(disk).summary} All of it, and every file, photo and document on this drive, will be lost.` : "The drive is empty."} This cannot be undone.</small></div>
                </div>
                <PartBar parts={layout} total={disk.sizeGB} />
                <TextField label={`Type ${CONFIRM_WORD} to confirm`} autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
              </>
            )}

            {installing && (
              <>
                <h1>{done ? "BrasOS is installed" : "Installing…"}</h1>
                {done ? (
                  <p className="lead">Remove the installer media and restart to start BrasOS.</p>
                ) : (
                  <>
                    <p className="lead">Please keep the computer on and plugged in. This usually takes 5 to 15 minutes.</p>
                    <div className="meter" role="progressbar" aria-label="Installing" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress?.percent ?? 0)}><i style={{ width: `${progress?.percent ?? 0}%` }} /></div>
                  </>
                )}
                <ol className="phases">
                  {PHASES.map((p, i) => {
                    const state = done || (progress && i < progress.phase) ? "done" : progress?.phase === i ? "now" : "todo";
                    return <li key={p} className={state}><span className="dot">{state === "done" ? "✓" : ""}</span>{p}</li>;
                  })}
                </ol>
              </>
            )}

            {error && <p role="alert" className="setup-error">{error}</p>}
          </div>

          <div className="setup-actions">
            {step > 0 && !installing && <Button onClick={() => (setError(""), setStep(step - 1))}>Back</Button>}
            <span className="grow" />
            {done ? (
              <Button variant="primary" autoFocus onClick={onRestart}>Restart</Button>
            ) : !installing && (
              <Button key={step} variant={step === 2 ? "danger" : "primary"} type="submit" disabled={step === 2 && !confirmed(typed)}>{step === 2 ? "Erase and install" : "Continue"}</Button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
