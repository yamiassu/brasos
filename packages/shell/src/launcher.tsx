// The launcher: opened by the start button, the search box or Ctrl+K. Empty query lists the apps; typing searches apps,
// open windows, files in the usual folders, and the guides. Up/Down move, Enter opens, Escape closes.
import { Icon, List } from "@brasos/ui";

export type Hit = { key: string; kind: "App" | "Window" | "File" | "Guide"; icon: string; label: string; meta?: string; run(): void };

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

export function Launcher({ hits, selected, onSelect, onRun, query }: { hits: Hit[]; selected: Hit | null; onSelect(h: Hit): void; onRun(h: Hit): void; query: string }) {
  return (
    <div className="ui-launcher" role="dialog" aria-label={query ? "Search results" : "Apps"}>
      <h4>{query ? "Results" : "Apps"}</h4>
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
