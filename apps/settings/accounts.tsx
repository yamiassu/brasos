// Settings → Accounts: the accounts on the lock screen. The owner (made at first boot) adds, renames, resets and removes the others;
// every change asks for the owner's password again. These are BrasOS profiles, not Linux users: one shared home folder, and a lock
// screen is not access control (the page says so). The host's routes are on the shell origin (`accounts.manage`).
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "@brasos/ui";

type Account = { username: string; display: string; owner: boolean; hasPin: boolean };
type List = { devSkip: boolean; accounts: Account[] };

const base = typeof location === "undefined" ? "" : `${location.protocol}//localhost${location.port ? ":" + location.port : ""}`;
const post = (path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const field = { display: "block", width: "100%", marginTop: 4 } as const;
const Field = ({ label, children }: { label: string; children: ReactNode }) => <label style={{ display: "block", marginTop: 10 }}>{label}{children}</label>;

export function AccountsPage() {
  const [list, setList] = useState<List | null | "none">(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [add, setAdd] = useState({ display: "", username: "", password: "", owner: "" });
  const [edit, setEdit] = useState<{ username: string; mode: "edit" | "delete"; display: string; password: string; owner: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(base + "/os/accounts", { cache: "no-store" });
      setList(r.ok ? await r.json() : "none");
    } catch {
      setList("none");
    }
  }, []);
  useEffect(() => void load(), [load]);

  const send = async (op: string, body: unknown, done: () => void, okText: string) => {
    setBusy(true);
    setErr("");
    setMsg("");
    const r = await post(`/os/accounts/${op}`, body).catch(() => null);
    setBusy(false);
    if (r?.ok) (done(), setMsg(okText), void load());
    else setErr(r?.status === 401 ? "Your password is not right." : ((await r?.json().catch(() => null)) as { error?: string } | null)?.error ?? "That did not work.");
  };

  if (list === null) return <section className="card"><p className="note">Checking…</p></section>;
  if (list === "none") return <section className="card"><p className="note">Accounts are not available here: this is the sample view (Storybook or a plain browser), or this system does not allow managing them.</p></section>;
  if (list.devSkip) return <section className="card"><p className="note">This is a development system with the first-boot shortcut: there is no lock screen and no accounts to manage.</p></section>;

  return (
    <>
      <section className="card">
        <h3>Accounts</h3>
        {list.accounts.map((a) => (
          <div key={a.username} className="row">
            <div>
              <div className="label">{a.display} {a.owner && <span className="pill ok">Owner</span>} {a.hasPin && <span className="pill off">PIN</span>}</div>
              <small>{a.username}</small>
            </div>
            <div className="control">
              <Button onClick={() => (setErr(""), setMsg(""), setEdit({ username: a.username, mode: "edit", display: a.display, password: "", owner: "" }))}>{a.owner ? "Rename" : "Change"}</Button>
              {!a.owner && <Button variant="danger" onClick={() => (setErr(""), setMsg(""), setEdit({ username: a.username, mode: "delete", display: a.display, password: "", owner: "" }))}>Remove</Button>}
            </div>
          </div>
        ))}
        {edit && (
          <form
            className="card"
            aria-label={edit.mode === "delete" ? `Remove ${edit.display}` : `Change ${edit.username}`}
            onSubmit={(e) => {
              e.preventDefault();
              const target = list.accounts.find((a) => a.username === edit.username)!;
              if (edit.mode === "delete") return void send("delete", { username: edit.username, ownerPassword: edit.owner }, () => setEdit(null), `${edit.display} was removed.`);
              void send("update", { username: edit.username, ownerPassword: edit.owner, ...(edit.display.trim() !== target.display ? { display: edit.display } : {}), ...(edit.password ? { newPassword: edit.password } : {}) }, () => setEdit(null), "Saved.");
            }}
          >
            {edit.mode === "delete" ? (
              <p>Remove <b>{edit.display}</b> ({edit.username})? They can no longer sign in. Their files are not deleted: every account shares the same home folder.</p>
            ) : (
              <>
                <Field label="Name"><input style={field} value={edit.display} onChange={(e) => setEdit({ ...edit, display: e.target.value })} /></Field>
                <Field label="New password (leave empty to keep it)"><input style={field} type="password" autoComplete="new-password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></Field>
                <p className="note">A new password also switches this account's PIN off.</p>
              </>
            )}
            <Field label="Your password (the owner's), to confirm"><input style={field} type="password" autoComplete="current-password" value={edit.owner} onChange={(e) => setEdit({ ...edit, owner: e.target.value })} /></Field>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <Button type="submit" variant={edit.mode === "delete" ? "danger" : "primary"} disabled={busy || !edit.owner}>{edit.mode === "delete" ? "Remove account" : "Save"}</Button>
              <Button type="button" onClick={() => setEdit(null)}>Cancel</Button>
            </div>
          </form>
        )}
      </section>

      <section className="card">
        <h3>Add an account</h3>
        <form
          aria-label="Add an account"
          onSubmit={(e) => {
            e.preventDefault();
            void send("create", { display: add.display, username: add.username, password: add.password, ownerPassword: add.owner }, () => setAdd({ display: "", username: "", password: "", owner: "" }), `${add.display} was added. They choose their account on the lock screen.`);
          }}
        >
          <Field label="Name"><input style={field} value={add.display} onChange={(e) => setAdd({ ...add, display: e.target.value })} /></Field>
          <Field label="Username (3 to 32 lowercase letters, digits, - or _)"><input style={field} value={add.username} autoCapitalize="none" onChange={(e) => setAdd({ ...add, username: e.target.value.toLowerCase() })} /></Field>
          <Field label="Password (10 or more characters)"><input style={field} type="password" autoComplete="new-password" value={add.password} onChange={(e) => setAdd({ ...add, password: e.target.value })} /></Field>
          <Field label="Your password (the owner's), to confirm"><input style={field} type="password" autoComplete="current-password" value={add.owner} onChange={(e) => setAdd({ ...add, owner: e.target.value })} /></Field>
          <div style={{ marginTop: 12 }}><Button type="submit" variant="primary" disabled={busy || !add.display || !add.username || !add.password || !add.owner}>Add account</Button></div>
        </form>
        {err && <p role="alert" className="note" style={{ color: "#ff7a7a" }}>{err}</p>}
        {msg && <p role="status" className="note">{msg}</p>}
        <p className="note">These accounts sign in on the lock screen. They are not separate Linux users: everyone shares the same files and apps, and a lock screen is not access control. The owner cannot be removed.</p>
      </section>
    </>
  );
}
