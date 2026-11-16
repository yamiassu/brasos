// The start menu: opened by the start button, the search box or Ctrl+K. With no query it shows the pinned apps, a few of
// your files, and who is signed in with lock and restart; typing searches apps, open windows, files in the usual folders,
// and the guides. Up/Down (and Left/Right when nothing is typed) move, Enter opens, Escape closes.
import { Icon, IconButton, List } from "@brasos/ui";

export type Hit = { key: string; kind: "App" | "Window" | "File" | "Guide"; icon: string; label: string; meta?: string; run(): void };
export type StartAction = { label: string; icon: string; onClick(): void };

/** every hit whose label contains the words typed, apps first; with no query, the apps */
export function search(all: Hit[], query: string): Hit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return all.filter((h) => h.kind === "App");
  const rank = { App: 0, Window: 1, File: 2, Guide: 3 } as const;
  return all
    .filter((h) => words.every((w) => h.label.toLowerCase().includes(w) || h.meta?.toLowerCase().includes(w)))
    .sort((a, b) => rank[a.kind] - rank[b.kind] || a.label.localeCompare(b.label))
    .slice(0, 40);
}

export function Launcher({ hits, selected, onSelect, onRun, query, files = [], user, actions = [], showAll = false, onToggleAll, onContext }: {
  hits: Hit[]; selected: Hit | null; onSelect(h: Hit): void; onRun(h: Hit): void; query: string;
  files?: Hit[]; user?: string; actions?: StartAction[];
  /** the pinned apps (or all of them), a switch between the two, and a right click on an app */
  showAll?: boolean; onToggleAll?(): void; onContext?(h: Hit, e: { clientX: number; clientY: number }): void;
}) {
  if (query) {
    return (
      <div className="ui-launcher" role="dialog" aria-label="Search results">
        <h4>Results</h4>
        {hits.length ? (
          <div className="scroll">
            <List label="Results" items={hits} selected={selected} onSelect={onSelect} onOpen={onRun} getKey={(h) => h.key}
              render={(h) => (<><Icon name={h.icon} size={18} /><span>{h.label}</span><span className="meta">{h.meta ?? h.kind}</span></>)} />
          </div>
        ) : (
          <div className="empty">Nothing matches “{query}”.</div>
        )}
      </div>
    );
  }
  return (
    <div className="ui-launcher ui-start" role="dialog" aria-label="Start">
      <div className="scroll">
        <h4>{showAll ? "All apps" : "Pinned"}{onToggleAll && <button type="button" className="ui-start-toggle" onClick={onToggleAll}>{showAll ? "Pinned" : "All apps"} ›</button>}</h4>
        {!hits.length && <div className="empty">Nothing is pinned. Open All apps and right-click one to pin it.</div>}
        <div className="ui-pinned" role="listbox" aria-label="Apps">
          {hits.map((h) => (
            <button key={h.key} type="button" role="option" aria-selected={selected?.key === h.key} className="ui-pin" onClick={() => onRun(h)} onContextMenu={(e) => onContext && (e.preventDefault(), onContext(h, e))}>
              <Icon name={h.icon} size={30} />
              <span>{h.label}</span>
            </button>
          ))}
        </div>
        {files.length > 0 && (
          <>
            <h4>Your files</h4>
            <div className="ui-recent">
              {files.map((f) => (
                <button key={f.key} type="button" onClick={() => onRun(f)}><Icon name={f.icon} size={16} /><span>{f.label}</span><small>{f.meta}</small></button>
              ))}
            </div>
          </>
        )}
      </div>
      <footer className="ui-start-foot">
        <span className="who"><Icon name="user" size={18} />{user ?? "Guest"}</span>
        {actions.map((a) => <IconButton key={a.label} label={a.label} onClick={a.onClick}><Icon name={a.icon} size={18} /></IconButton>)}
      </footer>
    </div>
  );
}
