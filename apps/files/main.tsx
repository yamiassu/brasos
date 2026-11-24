import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { os, type FsEntry } from "@brasos/sdk";
import { Breadcrumb, Button, Dialog, Icon, IconButton, IconTile, List, Menu, TextField, TitleBar, useMarquee, type MenuItem } from "@brasos/ui";
import "@brasos/ui/ui.css";
import "./files.css";
import { DrivesView, useDrives } from "./drives-view";
import { Properties } from "./properties";
import { Splitter } from "./splitter";
import { baseName, formatSize, iconFor, imageMime, isImage, isText, join, parent, sortEntries, startFromHash, validName, type SortKey } from "./paths";

type Pin = { path: string; dir: boolean };
const PINS = "files.pins";
const storedPins = (): Pin[] => {
  try {
    const v = JSON.parse(localStorage.getItem(PINS) ?? "[]");
    return Array.isArray(v) ? v.filter((p) => typeof p?.path === "string" && p.path.startsWith("/")).map((p) => ({ path: p.path, dir: !!p.dir })) : [];
  } catch {
    return [];
  }
};
type ViewOpts = { view: "list" | "grid"; props: boolean; hidden: boolean };
const VIEW = "files.view";
const storedView = (): ViewOpts => {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW) ?? "{}");
    return { view: v.view === "grid" ? "grid" : "list", props: !!v.props, hidden: v.hidden !== false };
  } catch {
    return { view: "list", props: false, hidden: true };
  }
};
const SIZES = "files.sizes";
const storedSizes = () => {
  try {
    const v = JSON.parse(localStorage.getItem(SIZES) ?? "{}");
    return { left: Math.min(360, Math.max(120, Number(v.left) || 168)), right: Math.min(640, Math.max(200, Number(v.right) || 300)) };
  } catch {
    return { left: 168, right: 300 };
  }
};
const DRIVES = "drives:"; // a place that is not a folder: the disks of this computer
const PLACES = [
  { name: "Home", path: "/", icon: "user" },
  { name: "Desktop", path: "/Desktop", icon: "app" },
  { name: "Documents", path: "/Documents", icon: "docs" },
  { name: "Trash", path: "/.trash", icon: "trash" },
  { name: "Drives", path: DRIVES, icon: "disk" },
];

type Preview = { name: string; kind: "text" | "image" | "none"; content?: string; note?: string };
type Ask = { title: string; label: string; initial: string; confirm: string; onSubmit(name: string): Promise<unknown> } | { title: string; confirmDelete: FsEntry[] };

function Files() {
  const start = startFromHash(location.hash);
  const [dir, setDir] = useState(start.dir);
  const [hist, setHist] = useState({ stack: [start.dir], i: 0 }); // back and forward
  const [opts, setOpts] = useState(storedView); // the view options, kept in this browser
  const { view, props: showProps, hidden: showHidden } = opts;
  const setView = (v: ViewOpts["view"]) => setOpts((o) => ({ ...o, view: v }));
  const [sizes, setSizes] = useState(storedSizes); // widths of the sidebar and the right bar, kept in this browser
  const [viewMenu, setViewMenu] = useState<{ x: number; y: number } | null>(null);
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
  const [renaming, setRenaming] = useState<string | null>(null); // the name of the entry being renamed in place
  const [pins, setPins] = useState(storedPins); // files and folders pinned to the sidebar (kept in this browser, per app)
  const [pinMenu, setPinMenu] = useState<{ x: number; y: number; pin: Pin } | null>(null);
  const anchor = useRef<string | null>(null); // where a Shift selection starts
  const inDrives = dir === DRIVES;
  const drives = useDrives(inDrives);

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
  const shown = sortEntries(entries, sort.key, sort.asc).filter((e) => (showHidden || !e.name.startsWith(".")) && e.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const sortBy = (key: SortKey) => setSort((s) => ({ key, asc: s.key === key ? !s.asc : true }));

  useEffect(() => {
    setFilter("");
    if (dir === DRIVES) (setEntries([]), setSelected(null), setMulti([]), setStatus(""));
    else load(dir, wantSelect);
    setWantSelect(undefined);
    setEditing(null);
    setRenaming(null);
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

  useEffect(() => {
    try {
      localStorage.setItem(PINS, JSON.stringify(pins));
    } catch {}
  }, [pins]);
  useEffect(() => {
    try {
      localStorage.setItem(VIEW, JSON.stringify(opts));
    } catch {}
  }, [opts]);
  useEffect(() => {
    try {
      localStorage.setItem(SIZES, JSON.stringify(sizes));
    } catch {}
  }, [sizes]);
  const isPinned = (path: string) => pins.some((p) => p.path === path);
  const togglePin = (path: string, isDir: boolean) => setPins((l) => (l.some((p) => p.path === path) ? l.filter((p) => p.path !== path) : [...l, { path, dir: isDir }]));
  // a pinned folder opens; a pinned file opens its folder with the file selected
  const openPin = (p: Pin) => {
    if (p.dir) return go(p.path);
    const folder = parent(p.path);
    if (folder === dir) return void load(dir, baseName(p.path));
    setWantSelect(baseName(p.path));
    go(folder);
  };
  const open = (e: FsEntry) => (e.kind === "dir" ? go(join(dir, e.name)) : pick(e));
  const after = (path = dir, select?: string) => load(path, select);

  const newFolder = () => setAsk({ title: "New folder", label: "Name", initial: "", confirm: "Create", onSubmit: async (n) => (await os.fs.mkdir(join(dir, n)), after(dir, n)) });
  const newFile = () => setAsk({ title: "New file", label: "Name", initial: "untitled.txt", confirm: "Create", onSubmit: async (n) => (await os.fs.write(join(dir, n), ""), after(dir, n)) });
  // rename in place: the name turns into an input (F2, the menu, the button)
  const renameOf = (t: FsEntry) => (pick(t), setRenaming(t.name));
  const commitRename = async (t: FsEntry, raw: string | null) => {
    setRenaming(null);
    const n = raw?.trim();
    if (!n || n === t.name) return;
    if (!validName(n)) return fail(new Error("That name can't be used"));
    if (entries.some((x) => x.name === n)) return fail(new Error(`"${n}" already exists`));
    try {
      await os.fs.move(join(dir, t.name), join(dir, n));
      after(dir, n);
    } catch (e) {
      fail(e);
    }
  };
  const editor = (e: FsEntry) => (renaming === e.name ? <RenameInput name={e.name} onDone={(v) => void commitRename(e, v)} /> : undefined);
  const removeOf = (t: FsEntry[]) => setAsk({ title: "Move to trash?", confirmDelete: t });
  const rename = () => selected && renameOf(selected);
  const remove = () => (selected ? removeOf([selected]) : multi.length && removeOf(entries.filter((e) => multi.includes(e.name))));
  const pick = (e: FsEntry | null) => (setMulti([]), setSelected(e), (anchor.current = e?.name ?? null));
  // Ctrl/Cmd toggles one item in or out of the selection; Shift selects everything from the last plain click (the anchor) to this one
  const pickWith = (e: FsEntry, m?: { ctrl: boolean; shift: boolean }) => {
    if (!m || (!m.ctrl && !m.shift)) return pick(e);
    const have = selected ? [selected.name] : multi;
    let names: string[];
    if (m.shift) {
      const names_ = shown.map((x) => x.name);
      const a = names_.indexOf(anchor.current ?? selected?.name ?? multi[0] ?? e.name);
      const b = names_.indexOf(e.name);
      names = names_.slice(Math.min(a < 0 ? b : a, b), Math.max(a < 0 ? b : a, b) + 1);
    } else {
      names = have.includes(e.name) ? have.filter((n) => n !== e.name) : [...have, e.name];
      anchor.current = e.name;
    }
    setSelected(names.length === 1 ? (entries.find((x) => x.name === names[0]) ?? null) : null);
    setMulti(names.length > 1 ? names : []);
  };
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
          { label: "Rename", onSelect: () => setTimeout(() => renameOf(t)) }, // after the menu has let go of focus
          { label: isPinned(join(dir, t.name)) ? "Unpin from sidebar" : "Pin to sidebar", onSelect: () => togglePin(join(dir, t.name), t.kind === "dir") },
          { label: "Copy path", onSelect: () => void navigator.clipboard?.writeText(join(dir, t.name)).then(() => setStatus("Path copied"), () => setStatus("Couldn't copy the path")) },
          { label: multi.length > 1 && multi.includes(t.name) ? `Move ${multi.length} items to trash` : "Move to trash", danger: true, onSelect: () => (multi.length > 1 && multi.includes(t.name) ? remove() : removeOf([t])) },
        ]
      : [
          { label: "New folder", onSelect: newFolder },
          { label: "New file", onSelect: newFile },
          { label: view === "list" ? "Show as icons" : "Show as list", onSelect: () => setView(view === "list" ? "grid" : "list") },
          ...(dir !== "/" && !inDrives ? [{ label: isPinned(dir) ? "Unpin this folder" : "Pin this folder", onSelect: () => togglePin(dir, true) }] : []),
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
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && !inDrives) {
      e.preventDefault(); // select everything in this view
      const names = shown.map((x) => x.name);
      anchor.current = names[0] ?? null;
      setSelected(names.length === 1 ? shown[0] : null);
      setMulti(names.length > 1 ? names : []);
      return;
    }
    if (e.key === "Delete") remove();
    else if (e.key === "F2") rename();
    else if (e.key === "Backspace" || (e.altKey && e.key === "ArrowUp")) dir !== "/" && !inDrives && (e.preventDefault(), go(parent(dir)));
  };

  return (
    <div className="files" onKeyDown={onKey}>
      <TitleBar window={os.window} title="Files" icon="files">
        <IconButton label="Back" disabled={hist.i === 0} onClick={() => step(-1)}>←</IconButton>
        <IconButton label="Forward" disabled={hist.i >= hist.stack.length - 1} onClick={() => step(1)}>→</IconButton>
        <IconButton label="Up one folder" disabled={dir === "/" || inDrives} onClick={() => go(parent(dir))}>↑</IconButton>
        <div className="grow">{inDrives ? <strong>Drives</strong> : <Breadcrumb path={dir} onNavigate={go} />}</div>
        <label className="find" hidden={inDrives}><Icon name="search" size={16} /><input type="search" placeholder="Filter" aria-label="Filter this folder" value={filter} onChange={(e) => setFilter(e.target.value)} /></label>
        <IconButton label="View options" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setViewMenu({ x: r.right - 180, y: r.bottom + 4 }); }}><Icon name="display" size={16} /></IconButton>
      </TitleBar>

      <div className="split">
        <nav className="places" aria-label="Places" style={{ width: sizes.left }}>
          {PLACES.map((p) => (
            <button key={p.path} type="button" aria-current={dir === p.path || (p.path !== "/" && dir.startsWith(p.path + "/")) ? "true" : undefined} onClick={() => (p.path === "/.trash" ? os.apps.open("trash").then((opened) => opened || go(p.path)) : go(p.path))}>
              <Icon name={p.icon} size={18} />{p.name}
            </button>
          ))}
          {pins.length > 0 && <h4 className="pinned">Pinned</h4>}
          {pins.map((p) => (
            <button key={p.path} type="button" title={p.path} aria-current={p.dir && dir === p.path ? "true" : undefined} onClick={() => openPin(p)} onContextMenu={(e) => (e.preventDefault(), setPinMenu({ x: e.clientX, y: e.clientY, pin: p }))}>
              <Icon name={p.dir ? "folder" : iconFor({ name: baseName(p.path), kind: "file" } as FsEntry)} size={18} /><span className="pin-name">{baseName(p.path)}</span>
            </button>
          ))}
          <div className="grow" />
          <Button disabled={inDrives} onClick={newFolder}>New folder</Button>
          <Button disabled={inDrives} onClick={newFile}>New file</Button>
          <Button disabled={!selected} onClick={rename}>Rename</Button>
          <Button variant="danger" disabled={!selected && multi.length < 2} onClick={remove}>Delete</Button>
        </nav>

        <Splitter side="left" label="Resize the sidebar" value={sizes.left} min={120} max={360} onChange={(left) => setSizes((z) => ({ ...z, left }))} />
        <div className="browse" onContextMenu={inDrives ? undefined : onContext} onPointerDown={inDrives ? undefined : marquee.onPointerDown}>
          {inDrives ? <DrivesView state={drives} /> : view === "list" ? (
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
                onSelect={pickWith}
                onOpen={open}
                render={(e) => (
                  <>
                    <Icon name={iconFor(e)} size={18} />
                    <span className="name">{renaming === e.name ? editor(e) : e.name}</span>
                    <span className="meta">{e.kind === "dir" ? "" : formatSize(e.size)}</span>
                    <span className="meta date">{new Date(e.mtime).toLocaleDateString()}</span>
                  </>
                )}
                style={{ flex: 1, minWidth: 0 }}
              />
            </>
          ) : (
            <div className="grid" role="group" aria-label={`Contents of ${dir}`}>
              {shown.map((e) => <IconTile key={e.name} icon={iconFor(e)} label={e.name} editor={editor(e)} itemKey={e.name} selected={selected?.name === e.name || multi.includes(e.name)} onSelect={(ev) => pickWith(e, { ctrl: ev.ctrlKey || ev.metaKey, shift: ev.shiftKey })} onOpen={() => open(e)} />)}
            </div>
          )}
          {!inDrives && !shown.length && <p className="empty">{filter ? "Nothing matches that filter." : "This folder is empty."}</p>}
        </div>

        {(preview || (showProps && !inDrives)) && (
          <>
          <Splitter side="right" label="Resize the right bar" value={sizes.right} min={200} max={640} onChange={(right) => setSizes((z) => ({ ...z, right }))} />
          <aside className="preview" aria-label={preview ? `Preview of ${preview.name}` : "Properties"} style={{ width: sizes.right }}>
            {showProps && !inDrives && <Properties dir={dir} entries={entries} selected={selected} multi={multi} />}
            {preview && !showProps && <h3>{preview.name}</h3>}
            {preview && !showProps && selected && <p className="note">{formatSize(selected.size)} · {new Date(selected.mtime).toLocaleString()}</p>}
            {preview && showProps && <h4 className="pane-title">Preview</h4>}
            {preview?.kind === "image" && <img src={preview.content} alt={preview.name} />}
            {preview?.kind === "text" && editing === null && <pre>{preview.content}</pre>}
            {preview?.kind === "text" && editing !== null && <textarea aria-label="Edit file" value={editing} onChange={(e) => setEditing(e.target.value)} />}
            {preview?.note && <p className="note">{preview.note}</p>}
            {preview?.kind === "text" && (
              <div className="actions">
                {editing === null ? (
                  <Button onClick={() => setEditing(preview?.content ?? "")}>Edit</Button>
                ) : (
                  <>
                    <Button variant="primary" onClick={save}>Save</Button>
                    <Button onClick={() => setEditing(null)}>Cancel</Button>
                  </>
                )}
              </div>
            )}
          </aside>
          </>
        )}
      </div>
      <div className="status" role="status">{status}</div>
      {marquee.box}
      {viewMenu && (
        <Menu
          x={viewMenu.x}
          y={viewMenu.y}
          onClose={() => setViewMenu(null)}
          items={[
            { label: `${view === "list" ? "✓ " : "    "}List`, onSelect: () => setView("list") },
            { label: `${view === "grid" ? "✓ " : "    "}Icons`, onSelect: () => setView("grid") },
            { label: `${showProps ? "✓ " : "    "}Properties bar`, onSelect: () => setOpts((o) => ({ ...o, props: !o.props })) },
            { label: `${showHidden ? "✓ " : "    "}Show hidden files`, onSelect: () => setOpts((o) => ({ ...o, hidden: !o.hidden })) },
          ]}
        />
      )}
      {pinMenu && <Menu items={[{ label: "Unpin from sidebar", onSelect: () => togglePin(pinMenu.pin.path, pinMenu.pin.dir) }]} x={pinMenu.x} y={pinMenu.y} onClose={() => setPinMenu(null)} />}
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

/** the name of an entry as an input: Enter or leaving it renames, Escape cancels; the extension is left out of the selection */
function RenameInput({ name, onDone }: { name: string; onDone(v: string | null): void }) {
  const skip = useRef(false);
  const dot = name.lastIndexOf(".");
  return (
    <input
      className="rename"
      defaultValue={name}
      aria-label="New name"
      ref={(el) => el && document.activeElement !== el && (el.focus(), el.setSelectionRange(0, dot > 0 ? dot : name.length))}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => (e.stopPropagation(), e.key === "Enter" ? e.currentTarget.blur() : e.key === "Escape" && ((skip.current = true), e.currentTarget.blur()))}
      onBlur={(e) => onDone(skip.current ? null : e.currentTarget.value)}
    />
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
