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

export function InstallPrompt({ info, busy, error, onInstall, onCancel }: { info: Inspection; busy?: boolean; error?: string; onInstall(grant: string[]): void; onCancel(): void }) {
  // granted by default only what is low risk; the user ticks the rest on purpose
  const [on, setOn] = useState<Set<string>>(() => new Set(info.requested.filter((r) => r.grantable && r.risk === "low").map((r) => r.id)));
  const toggle = (id: string) => setOn((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set(s).add(id)));
  return (
    <Dialog
      title={`Install ${info.name}?`}
      onClose={onCancel}
      actions={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" autoFocus disabled={busy} onClick={() => onInstall([...on])}>{busy ? "Installing…" : "Install"}</Button>
        </>
      }
    >
      <p>
        <strong>{info.name}</strong> from <code>{info.origin}</code> will run as a web app inside BrasOS.
      </p>
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
      <p className="muted">You can change this later by installing it again.</p>
      {error && <p role="alert" className="setup-error">{error}</p>}
    </Dialog>
  );
}
