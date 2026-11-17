import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { os, type FsEntry } from "@brasos/sdk";
import { Breadcrumb, Button, Dialog, Icon, IconButton, IconTile, List, Menu, TextField, Toolbar, useMarquee, type MenuItem } from "@brasos/ui";
import "@brasos/ui/ui.css";
import "./files.css";
import { baseName, formatSize, iconFor, imageMime, isImage, isText, join, parent, sortEntries, startFromHash, validName, type SortKey } from "./paths";

const PLACES = [
  { name: "Home", path: "/", icon: "user" },
  { name: "Desktop", path: "/Desktop", icon: "app" },
  { name: "Documents", path: "/Documents", icon: "docs" },
  { name: "Trash", path: "/.trash", icon: "trash" },
];

type Preview = { name: string; kind: "text" | "image" | "none"; content?: string; note?: string };
type Ask = { title: string; label: string; initial: string; confirm: string; onSubmit(name: string): Promise<unknown> } | { title: string; confirmDelete: FsEntry[] };

function Files() {
  const start = startFromHash(location.hash);
  const [dir, setDir] = useState(start.dir);
  const [hist, setHist] = useState({ stack: [start.dir], i: 0 }); // back and forward
  const [view, setView] = useState<"list" | "grid">("list");
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "name", asc: true });
  const [filter, setFilter] = useState("");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [selected, setSelected] = useState<FsEntry | null>(null);
  const [multi, setMulti] = useState<string[]>([]); // names picked with a selection box (two or more); `selected` is then empty
  const [wantSelect, setWantSelect] = useState(start.select);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // draft text while editing
  const [ask, setAsk] = useState<Ask | null>(null);
  const [status, setStatus] = useState("");
  const loaded = useRef(0);

  const fail = (e: unknown) => setStatus((e as Error).message.replace(/^BrasOS [^:]*: \d+ /, "").replace(/^\{"error":"(.*)"\}$/, "$1"));

  const load = useCallback(async (path: string, select?: string) => {
    const ticket = ++loaded.current;
    try {
      const list = await os.fs.list(path);
      if (ticket !== loaded.current) return;
      setEntries(list);
      setSelected(list.find((e) => e.name === select) ?? null);
      setMulti([]);
      setStatus(`${list.length} item${list.length === 1 ? "" : "s"}`);
    } catch (e) {
      fail(e);
    }
  }, []);

  const go = (path: string) => {
    if (path === dir) return;
    setHist((h) => ({ stack: [...h.stack.slice(0, h.i + 1), path], i: h.i + 1 }));
    setDir(path);
  };
  const step = (d: -1 | 1) => hist.stack[hist.i + d] !== undefined && (setHist({ ...hist, i: hist.i + d }), setDir(hist.stack[hist.i + d]));
  const shown = sortEntries(entries, sort.key, sort.asc).filter((e) => e.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const sortBy = (key: SortKey) => setSort((s) => ({ key, asc: s.key === key ? !s.asc : true }));

  useEffect(() => {
    setFilter("");
    load(dir, wantSelect);
    setWantSelect(undefined);
    setEditing(null);
  }, [dir]);

  // the shell (or another app) changed something on disk: reload what we show
  useEffect(() => {
    const onHash = () => (setDir(startFromHash(location.hash).dir), setWantSelect(startFromHash(location.hash).select));
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  // preview whatever is selected
  useEffect(() => {
    setEditing(null);
    if (!selected || selected.kind === "dir") return setPreview(null);
    const path = join(dir, selected.name);
    const name = selected.name;
    let cancelled = false;
    (async () => {
      try {
        if (isText(name) || (!isImage(name) && selected.size < 100_000)) {
          const r = await os.fs.read(path);
          if (!cancelled) setPreview(r.encoding === "utf8" ? { name, kind: "text", content: r.content, note: r.truncated ? "Showing the first part only" : undefined } : { name, kind: "none", note: "Binary file" });
        } else if (isImage(name) && selected.size <= 1024 * 1024) {
          const r = await os.fs.read(path);
          if (!cancelled) setPreview({ name, kind: "image", content: `data:${imageMime(name)};base64,${r.content}` });
        } else if (!cancelled) setPreview({ name, kind: "none", note: "No preview" });
      } catch (e) {
        if (!cancelled) setPreview({ name, kind: "none", note: (e as Error).message });
      }
    })();
    return () => void (cancelled = true);
  }, [selected?.name, selected?.mtime, dir]);

  const open = (e: FsEntry) => (e.kind === "dir" ? go(join(dir, e.name)) : pick(e));
  const after = (path = dir, select?: string) => load(path, select);

  const newFolder = () => setAsk({ title: "New folder", label: "Name", initial: "", confirm: "Create", onSubmit: async (n) => (await os.fs.mkdir(join(dir, n)), after(dir, n)) });
  const newFile = () => setAsk({ title: "New file", label: "Name", initial: "untitled.txt", confirm: "Create", onSubmit: async (n) => (await os.fs.write(join(dir, n), ""), after(dir, n)) });
  const renameOf = (t: FsEntry) => setAsk({ title: "Rename", label: "New name", initial: t.name, confirm: "Rename", onSubmit: async (n) => (await os.fs.move(join(dir, t.name), join(dir, n)), after(dir, n)) });
  const removeOf = (t: FsEntry[]) => setAsk({ title: "Move to trash?", confirmDelete: t });
  const rename = () => selected && renameOf(selected);
  const remove = () => (selected ? removeOf([selected]) : multi.length && removeOf(entries.filter((e) => multi.includes(e.name))));
  const pick = (e: FsEntry | null) => (setMulti([]), setSelected(e));
  const marquee = useMarquee(
    (keys) => (keys.length === 1 ? (setMulti([]), setSelected(entries.find((e) => e.name === keys[0]) ?? null)) : (setSelected(null), setMulti(keys))),
    () => (setSelected(null), setMulti([])),
  );

  // right click: on an item it offers what you can do with it, on empty space what you can do in this folder
  const [menu, setMenu] = useState<{ x: number; y: number; target: FsEntry | null } | null>(null);
  const onContext = (e: React.MouseEvent) => {
    e.preventDefault();
    const el = e.target as HTMLElement;
    const name = el.closest(".ui-item")?.querySelector(".name")?.textContent ?? el.closest(".ui-tile")?.getAttribute("aria-label");
    const target = entries.find((x) => x.name === name) ?? null;
    if (target && !multi.includes(target.name)) pick(target);
    setMenu({ x: e.clientX, y: e.clientY, target });
  };
  const menuItems = (t: FsEntry | null): MenuItem[] =>
    t
      ? [
          ...(t.kind === "dir" ? [{ label: "Open", onSelect: () => open(t) }] : []),
          { label: "Rename", onSelect: () => renameOf(t) },
          { label: "Copy path", onSelect: () => void navigator.clipboard?.writeText(join(dir, t.name)).then(() => setStatus("Path copied"), () => setStatus("Couldn't copy the path")) },
          { label: multi.length > 1 && multi.includes(t.name) ? `Move ${multi.length} items to trash` : "Move to trash", danger: true, onSelect: () => (multi.length > 1 && multi.includes(t.name) ? remove() : removeOf([t])) },
        ]
      : [
          { label: "New folder", onSelect: newFolder },
          { label: "New file", onSelect: newFile },
          { label: view === "list" ? "Show as icons" : "Show as list", onSelect: () => setView(view === "list" ? "grid" : "list") },
          { label: "Refresh", onSelect: () => load(dir) },
        ];
  const save = async () => {
    if (editing === null || !selected) return;
    try {
      await os.fs.write(join(dir, selected.name), editing);
      setEditing(null);
      setStatus("Saved");
      after(dir, selected.name);
    } catch (e) {
      fail(e);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (ask || editing !== null) return;
    if (e.key === "Delete") remove();
    else if (e.key === "F2") rename();
    else if (e.key === "Backspace" || (e.altKey && e.key === "ArrowUp")) dir !== "/" && (e.preventDefault(), go(parent(dir)));
  };

  return (
    <div className="files" onKeyDown={onKey}>
      <Toolbar label="Files actions">
        <IconButton label="Back" disabled={hist.i === 0} onClick={() => step(-1)}>←</IconButton>
        <IconButton label="Forward" disabled={hist.i >= hist.stack.length - 1} onClick={() => step(1)}>→</IconButton>
        <IconButton label="Up one folder" disabled={dir === "/"} onClick={() => go(parent(dir))}>↑</IconButton>
        <div className="grow"><Breadcrumb path={dir} onNavigate={go} /></div>
        <label className="find"><Icon name="search" size={16} /><input type="search" placeholder="Filter" aria-label="Filter this folder" value={filter} onChange={(e) => setFilter(e.target.value)} /></label>
        <IconButton label={view === "list" ? "Show as icons" : "Show as list"} onClick={() => setView(view === "list" ? "grid" : "list")}>{view === "list" ? "▦" : "☰"}</IconButton>
      </Toolbar>

      <div className="split">
        <nav className="places" aria-label="Places">
          {PLACES.map((p) => (
            <button key={p.path} type="button" aria-current={dir === p.path || (p.path !== "/" && dir.startsWith(p.path + "/")) ? "true" : undefined} onClick={() => go(p.path)}>
              <Icon name={p.icon} size={18} />{p.name}
            </button>
          ))}
          <div className="grow" />
          <Button onClick={newFolder}>New folder</Button>
          <Button onClick={newFile}>New file</Button>
          <Button disabled={!selected} onClick={rename}>Rename</Button>
          <Button variant="danger" disabled={!selected && multi.length < 2} onClick={remove}>Delete</Button>
        </nav>

        <div className="browse" onContextMenu={onContext} onPointerDown={marquee.onPointerDown}>
          {view === "list" ? (
            <>
              <div className="cols" role="group" aria-label="Sort by">
                {([["name", "Name"], ["size", "Size"], ["mtime", "Modified"]] as const).map(([k, l]) => (
                  <button key={k} type="button" className={k} aria-pressed={sort.key === k} onClick={() => sortBy(k)}>{l}{sort.key === k ? (sort.asc ? " ↑" : " ↓") : ""}</button>
                ))}
              </div>
              <List
                label={`Contents of ${dir}`}
                items={shown}
                selected={selected}
                marked={multi}
                getKey={(e) => e.name}
                onSelect={pick}
                onOpen={open}
                render={(e) => (
                  <>
                    <Icon name={iconFor(e)} size={18} />
                    <span className="name">{e.name}</span>
                    <span className="meta">{e.kind === "dir" ? "" : formatSize(e.size)}</span>
                    <span className="meta date">{new Date(e.mtime).toLocaleDateString()}</span>
                  </>
                )}
                style={{ flex: 1, minWidth: 0 }}
              />
            </>
          ) : (
            <div className="grid" role="group" aria-label={`Contents of ${dir}`}>
              {shown.map((e) => <IconTile key={e.name} icon={iconFor(e)} label={e.name} itemKey={e.name} selected={selected?.name === e.name || multi.includes(e.name)} onSelect={() => pick(e)} onOpen={() => open(e)} />)}
            </div>
          )}
          {!shown.length && <p className="empty">{filter ? "Nothing matches that filter." : "This folder is empty."}</p>}
        </div>

        {preview && (
          <aside className="preview" aria-label={`Preview of ${preview.name}`}>
            <h3>{preview.name}</h3>
            {selected && <p className="note">{formatSize(selected.size)} · {new Date(selected.mtime).toLocaleString()}</p>}
            {preview.kind === "image" && <img src={preview.content} alt={preview.name} />}
            {preview.kind === "text" && editing === null && <pre>{preview.content}</pre>}
            {preview.kind === "text" && editing !== null && <textarea aria-label="Edit file" value={editing} onChange={(e) => setEditing(e.target.value)} />}
            {preview.note && <p className="note">{preview.note}</p>}
            {preview.kind === "text" && (
              <div className="actions">
                {editing === null ? (
                  <Button onClick={() => setEditing(preview.content ?? "")}>Edit</Button>
                ) : (
                  <>
                    <Button variant="primary" onClick={save}>Save</Button>
                    <Button onClick={() => setEditing(null)}>Cancel</Button>
                  </>
                )}
              </div>
            )}
          </aside>
        )}
      </div>
      <div className="status" role="status">{status}</div>
      {marquee.box}
      {menu && <Menu items={menuItems(menu.target)} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}

      {ask && "confirmDelete" in ask && (
        <Dialog
          title={ask.title}
          onClose={() => setAsk(null)}
          actions={
            <>
              <Button onClick={() => setAsk(null)}>Cancel</Button>
              <Button variant="danger" autoFocus onClick={() => (setAsk(null), Promise.all(ask.confirmDelete.map((t) => os.fs.remove(join(dir, t.name)))).then(() => after()).catch((e) => (fail(e), after())))}>Move to trash</Button>
            </>
          }
        >
          <p>{ask.confirmDelete.length === 1 ? ask.confirmDelete[0].name : `${ask.confirmDelete.length} items`} will go to the trash.</p>
        </Dialog>
      )}
      {ask && "onSubmit" in ask && <NameDialog ask={ask} onClose={() => setAsk(null)} onError={fail} />}
    </div>
  );
}

function NameDialog({ ask, onClose, onError }: { ask: Extract<Ask, { onSubmit: unknown }>; onClose(): void; onError(e: unknown): void }) {
  const [name, setName] = useState(ask.initial);
  const submit = () => validName(name) && (onClose(), ask.onSubmit(name.trim()).catch(onError));
  return (
    <Dialog title={ask.title} onClose={onClose} actions={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!validName(name)} onClick={submit}>{ask.confirm}</Button></>}>
      <TextField label={ask.label} value={name} autoFocus onFocus={(e) => e.currentTarget.select()} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
    </Dialog>
  );
}

// the page mounts when there is a #root; Storybook imports the component instead
const mount = document.getElementById("root");
if (mount) createRoot(mount).render(<Files />);

export { Files };
