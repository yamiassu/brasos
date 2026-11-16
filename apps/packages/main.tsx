import { useState } from "react";
import { createRoot } from "react-dom/client";
import { os } from "@brasos/sdk";
import { Button, Dialog, Icon } from "@brasos/ui";
import "@brasos/ui/ui.css";
import "./packages.css";
import { BY_ID, CATALOG, KINDS, plan, requiredBy, usePackages, type Kind, type Pkg } from "./data";

const KIND_ICON: Record<Kind, string> = { App: "app", Driver: "chip", Library: "files", Tool: "terminal" };
const KIND_PLURAL: Record<Kind, string> = { App: "Apps", Driver: "Drivers", Library: "Libraries", Tool: "Tools" };
type Filter = "all" | "installed" | "available";
const mb = (v: number) => (v >= 1024 ? `${(v / 1024).toFixed(1)} GB` : `${v} MB`);

function Packages() {
  const pk = usePackages();
  const [kind, setKind] = useState<Kind | "all">("all");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ pkg: Pkg; action: "install" | "remove" } | null>(null);

  const rows = CATALOG.filter((p) =>
    (kind === "all" || p.kind === kind) &&
    (filter === "all" || (filter === "installed") === pk.installed.has(p.id)) &&
    `${p.name} ${p.id} ${p.summary}`.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const sel = selected ? BY_ID.get(selected) ?? null : null;
  const count = (k: Kind | "all") => CATALOG.filter((p) => (k === "all" || p.kind === k) && pk.installed.has(p.id)).length;

  const state = (p: Pkg) => (pk.busy.get(p.id) === "installing" ? "Installing…" : pk.busy.get(p.id) === "removing" ? "Removing…" : pk.installed.has(p.id) ? (pk.manual.has(p.id) ? "Installed" : "Dependency") : "Available");

  return (
    <div className="pk">
      <nav aria-label="Categories">
        <h1>Packages</h1>
        {(["all", ...KINDS] as const).map((k) => (
          <button key={k} type="button" aria-current={kind === k ? "page" : undefined} onClick={() => setKind(k)}>
            <Icon name={k === "all" ? "package" : KIND_ICON[k]} size={18} />{k === "all" ? "Everything" : KIND_PLURAL[k]}<span className="count">{count(k)}</span>
          </button>
        ))}
        {pk.sample && <span className="sample" title="No package data from the host yet: this catalog is made up, and nothing is really installed">Sample data</span>}
      </nav>

      <main>
        <div className="bar">
          <label className="find"><Icon name="search" size={16} /><input type="search" placeholder="Search packages" aria-label="Search packages" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <div role="tablist" aria-label="Show">
            {(["all", "installed", "available"] as const).map((f) => <button key={f} role="tab" type="button" aria-selected={filter === f} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)}</button>)}
          </div>
        </div>

        <div className="split">
          <div className="list" role="listbox" aria-label="Packages">
            {rows.map((p) => (
              <div key={p.id} role="option" aria-selected={selected === p.id} className="item" onClick={() => setSelected(p.id)}>
                <Icon name={KIND_ICON[p.kind]} size={20} />
                <div className="what"><b>{p.name}</b><small>{p.summary}</small></div>
                <span className={`state ${state(p).toLowerCase().replace("…", "")}`}>{state(p)}</span>
              </div>
            ))}
            {!rows.length && <p className="empty">No package matches.</p>}
          </div>

          {sel && (
            <aside aria-label={`Details of ${sel.name}`}>
              <h2>{sel.name}</h2>
              <p className="meta"><span>{sel.kind}</span><span>{sel.version}</span><span>{mb(sel.size)}</span></p>
              <p>{sel.summary}</p>

              <h4>Needs</h4>
              {sel.deps.length ? <ul>{sel.deps.map((d) => <li key={d} className={pk.installed.has(d) ? "have" : "missing"}>{BY_ID.get(d)?.name ?? d}<small>{pk.installed.has(d) ? "installed" : "will be installed"}</small></li>)}</ul> : <p className="note">Nothing else.</p>}

              <h4>Needed by</h4>
              {(() => { const r = requiredBy(sel.id, pk.installed); return r.length ? <ul>{r.map((d) => <li key={d.id} className="have">{d.name}</li>)}</ul> : <p className="note">Nothing installed needs it.</p>; })()}

              <div className="actions">
                {pk.installed.has(sel.id)
                  ? <Button variant="danger" disabled={pk.busy.has(sel.id)} onClick={() => setAsk({ pkg: sel, action: "remove" })}>Remove</Button>
                  : <Button variant="primary" disabled={pk.busy.has(sel.id)} onClick={() => setAsk({ pkg: sel, action: "install" })}>Install</Button>}
              </div>
            </aside>
          )}
        </div>
      </main>

      {ask && <Confirm pk={pk} pkg={ask.pkg} action={ask.action} onClose={() => setAsk(null)} />}
    </div>
  );
}

function Confirm({ pk, pkg, action, onClose }: { pk: ReturnType<typeof usePackages>; pkg: Pkg; action: "install" | "remove"; onClose(): void }) {
  if (action === "install") {
    const all = plan(pkg.id, pk.installed);
    const extra = all.filter((p) => p.id !== pkg.id);
    const size = all.reduce((a, p) => a + p.size, 0);
    return (
      <Dialog title={`Install ${pkg.name}?`} onClose={onClose} actions={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" autoFocus onClick={() => (pk.install(pkg.id), onClose())}>Install</Button></>}>
        <p>This adds {all.length} package{all.length === 1 ? "" : "s"}, {mb(size)} in total.</p>
        {extra.length > 0 && <><p className="note">Also needed:</p><ul className="plan">{extra.map((p) => <li key={p.id}>{p.name}<small>{mb(p.size)}</small></li>)}</ul></>}
      </Dialog>
    );
  }
  const blockers = requiredBy(pkg.id, pk.installed);
  return (
    <Dialog title={blockers.length ? `${pkg.name} can't be removed` : `Remove ${pkg.name}?`} onClose={onClose} actions={blockers.length ? <Button autoFocus onClick={onClose}>OK</Button> : <><Button onClick={onClose}>Cancel</Button><Button variant="danger" autoFocus onClick={() => (pk.remove(pkg.id), onClose())}>Remove</Button></>}>
      {blockers.length ? <><p>These installed packages need it:</p><ul className="plan">{blockers.map((p) => <li key={p.id}>{p.name}</li>)}</ul><p className="note">Remove them first.</p></> : <p>It frees {mb(pkg.size)}. Packages it pulled in stay until you remove them.</p>}
    </Dialog>
  );
}

void os; // importing the SDK makes the window answer the shell's "is it responding" check

// the page mounts when there is a #root; Storybook imports the component instead
const mount = document.getElementById("root");
if (mount) createRoot(mount).render(<Packages />);

export { Packages };
