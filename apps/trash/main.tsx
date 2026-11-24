import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { os, type TrashEntry } from "@brasos/sdk";
import { Button, Dialog, Icon, List, Toolbar } from "@brasos/ui";
import "@brasos/ui/ui.css";
import "./trash.css";
import { formatSize, iconFor } from "../files/paths";
import { matches, originalFolder, originalName, when } from "./model";

type Ask = { kind: "purge"; items: TrashEntry[] } | { kind: "empty" };

function Trash() {
  const [items, setItems] = useState<TrashEntry[] | null>(null);
  const [sel, setSel] = useState<TrashEntry | null>(null);
  const [marked, setMarked] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [ask, setAsk] = useState<Ask | null>(null);
  const [status, setStatus] = useState("");

  const load = useCallback(() => os.fs.trash().then(setItems, (e) => (setItems([]), setStatus(String(e?.message ?? e)))), []);
  useEffect(() => {
    load();
    addEventListener("focus", load); // something may have been deleted in another window meanwhile
    return () => removeEventListener("focus", load);
  }, [load]);

  const shown = (items ?? []).filter((e) => matches(e, q));
  const chosen = shown.filter((e) => marked.includes(e.name));
  const total = (items ?? []).reduce((n, e) => n + e.size, 0);

  const select = (e: TrashEntry, mods?: { ctrl: boolean; shift: boolean }) => {
    if (mods?.shift && sel) {
      const [a, b] = [shown.indexOf(sel), shown.indexOf(e)].sort((x, y) => x - y);
      setMarked(shown.slice(a, b + 1).map((x) => x.name));
    } else if (mods?.ctrl) setMarked((m) => (m.includes(e.name) ? m.filter((x) => x !== e.name) : [...m, e.name]));
    else setMarked([e.name]);
    setSel(e);
  };

  const run = async (what: string, list: TrashEntry[], op: (e: TrashEntry) => Promise<unknown>) => {
    const failed: string[] = [];
    for (const e of list) await op(e).catch(() => failed.push(originalName(e)));
    setStatus(failed.length ? `Couldn't ${what} ${failed.join(", ")}` : `${list.length === 1 ? originalName(list[0]) : `${list.length} items`} ${what === "restore" ? "restored" : "deleted"}`);
    setMarked([]);
    setSel(null);
    load();
  };
  const restore = (list: TrashEntry[]) => run("restore", list, (e) => os.fs.restore(e.name));

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Delete" && chosen.length) (e.preventDefault(), setAsk({ kind: "purge", items: chosen }));
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") (e.preventDefault(), setMarked(shown.map((x) => x.name)));
  };

  return (
    <div className="trash" onKeyDown={onKey}>
      <Toolbar label="Trash">
        <Button disabled={!chosen.length} onClick={() => restore(chosen)}>
          <Icon name="restart" size={16} /> Restore
        </Button>
        <Button variant="danger" disabled={!chosen.length} onClick={() => setAsk({ kind: "purge", items: chosen })}>
          Delete forever
        </Button>
        <span className="grow" />
        <input className="find" type="search" placeholder="Search the trash" aria-label="Search the trash" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button variant="danger" disabled={!items?.length} onClick={() => setAsk({ kind: "empty" })}>
          Empty trash
        </Button>
      </Toolbar>
      <div className="cols" aria-hidden>
        <span className="name">Name</span>
        <span className="from">Deleted from</span>
        <span className="when">Deleted</span>
        <span className="size">Size</span>
      </div>
      {items === null ? (
        <p className="empty">Loading…</p>
      ) : !shown.length ? (
        <p className="empty">{items.length ? "Nothing matches." : "The trash is empty."}</p>
      ) : (
        <List
          label="Deleted items"
          items={shown}
          selected={sel}
          marked={marked}
          getKey={(e) => e.name}
          onSelect={select}
          onOpen={(e) => restore([e])}
          render={(e) => (
            <>
              <Icon name={iconFor(e)} size={18} />
              <span className="name" title={originalName(e)}>{originalName(e)}</span>
              <span className="from" title={e.from ?? undefined}>{originalFolder(e)}</span>
              <span className="when">{when(e.deleted)}</span>
              <span className="size">{e.kind === "dir" ? "Folder" : formatSize(e.size)}</span>
            </>
          )}
        />
      )}
      <div className="status" role="status">
        {status || (items?.length ? `${items.length} item${items.length === 1 ? "" : "s"} · ${formatSize(total)}${chosen.length > 1 ? ` · ${chosen.length} selected` : ""}` : "")}
      </div>
      {ask && (
        <Dialog
          title={ask.kind === "empty" ? "Empty the trash?" : "Delete forever?"}
          onClose={() => setAsk(null)}
          actions={
            <>
              <Button onClick={() => setAsk(null)}>Cancel</Button>
              <Button
                variant="danger"
                autoFocus
                onClick={() => {
                  const a = ask;
                  setAsk(null);
                  if (a.kind === "empty") os.fs.emptyTrash().then((r) => (setStatus(`Trash emptied (${r.removed} item${r.removed === 1 ? "" : "s"})`), load()), (e) => setStatus(String(e?.message ?? e)));
                  else run("delete", a.items, (e) => os.fs.purge(e.name));
                }}
              >
                Delete forever
              </Button>
            </>
          }
        >
          <p>
            {ask.kind === "empty" ? `All ${items?.length ?? 0} items` : ask.items.length === 1 ? originalName(ask.items[0]) : `${ask.items.length} items`} will be deleted permanently. This can't be undone.
          </p>
        </Dialog>
      )}
    </div>
  );
}

const mount = document.getElementById("root");
if (mount) createRoot(mount).render(<Trash />);

export { Trash };
