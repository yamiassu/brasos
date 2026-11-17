// The install prompt: shown by the shell (never by the app asking), listing what the app wants to be able to do, in plain words
// and with the app's own reason. The user unticks what they don't want; what is ticked is what gets granted. Pure UI (Storybook).
import { useState } from "react";
import { Badge, Button, Dialog } from "@brasos/ui";

export type Inspection = {
  name: string;
  origin: string;
  start_url: string;
  requested: { id: string; label: string; risk: "low" | "medium" | "high"; reason: string; grantable: boolean }[];
  frameless: boolean;
};

export type RunIn = "brasos" | "browser";

export function InstallPrompt({ info, busy, error, canRunInBrowser, fromBrowser, onInstall, onCancel }: { info: Inspection; busy?: boolean; error?: string; /** the real browser is here, so the app can run in it */ canRunInBrowser?: boolean; /** the request came from the browser's own install */ fromBrowser?: boolean; onInstall(grant: string[], runIn: RunIn): void; onCancel(): void }) {
  // granted by default only what is low risk; the user ticks the rest on purpose
  const [on, setOn] = useState<Set<string>>(() => new Set(info.requested.filter((r) => r.grantable && r.risk === "low").map((r) => r.id)));
  const [runIn, setRunIn] = useState<RunIn>("brasos");
  const toggle = (id: string) => setOn((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set(s).add(id)));
  return (
    <Dialog
      title={`Install ${info.name}?`}
      onClose={onCancel}
      actions={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" autoFocus disabled={busy} onClick={() => onInstall([...on], canRunInBrowser ? runIn : "brasos")}>{busy ? "Installing…" : "Install"}</Button>
        </>
      }
    >
      <p>
        {fromBrowser ? <>You installed <strong>{info.name}</strong> in the browser. </> : null}
        <strong>{fromBrowser ? "BrasOS" : info.name}</strong>{fromBrowser ? " can add it" : ""} from <code>{info.origin}</code>{fromBrowser ? " as an app." : " will run as a web app."}
      </p>
      {canRunInBrowser && (
        <fieldset className="install-run" aria-label="Where it runs">
          <legend>Where should it run?</legend>
          <label>
            <input type="radio" name="runin" checked={runIn === "brasos"} onChange={() => setRunIn("brasos")} />
            <span className="what">In BrasOS <small className="muted">(sandboxed: its own protected window. Sign-in with passkeys, some logins and notifications may not work.)</small></span>
          </label>
          <label>
            <input type="radio" name="runin" checked={runIn === "browser"} onChange={() => setRunIn("browser")} />
            <span className="what">In the real browser <small className="muted">(an app window of your browser. Everything works like on the web, but it is not isolated from your other browsing and BrasOS can't give it any access to your files.)</small></span>
          </label>
        </fieldset>
      )}
      {info.requested.length ? (
        <>
          <p>It asks to be able to:</p>
          <ul className="install-perms" aria-label="Permissions requested">
            {info.requested.map((r) => (
              <li key={r.id}>
                <label>
                  <input type="checkbox" checked={on.has(r.id)} disabled={!r.grantable} onChange={() => toggle(r.id)} />
                  <span className="what">{r.label}</span>
                  <Badge>{r.grantable ? r.risk : "not available"}</Badge>
                </label>
                {r.reason && <p className="muted">“{r.reason}”</p>}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted">It asks for no access to your files or to BrasOS. It can still use the internet like any web page.</p>
      )}
      <p className="muted">{canRunInBrowser && runIn === "browser" ? "The permissions above apply only to a BrasOS window." : "You can change this later by installing it again."}</p>
      {error && <p role="alert" className="setup-error">{error}</p>}
    </Dialog>
  );
}
