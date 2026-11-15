import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { os, type FsEntry } from "@brasos/sdk";
import { Breadcrumb, Button, Dialog, Icon, IconButton, List, TextField, Toolbar } from "@brasos/ui";
import "@brasos/ui/ui.css";
import "./files.css";
import { baseName, formatSize, iconFor, imageMime, isImage, isText, join, parent, startFromHash, validName } from "./paths";

type Preview = { name: string; kind: "text" | "image" | "none"; content?: string; note?: string };
type Ask = { title: string; label: string; initial: string; confirm: string; onSubmit(name: string): Promise<unknown> } | { title: string; confirmDelete: FsEntry };

function Files() {
  const start = startFromHash(location.hash);
  const [dir, setDir] = useState(start.dir);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [selected, setSelected] = useState<FsEntry | null>(null);
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
      setStatus(`${list.length} item${list.length === 1 ? "" : "s"}`);
    } catch (e) {
      fail(e);
    }
  }, []);

  useEffect(() => {
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

  const open = (e: FsEntry) => (e.kind === "dir" ? setDir(join(dir, e.name)) : setSelected(e));
  const after = (path = dir, select?: string) => load(path, select);

  const newFolder = () => setAsk({ title: "New folder", label: "Name", initial: "", confirm: "Create", onSubmit: async (n) => (await os.fs.mkdir(join(dir, n)), after(dir, n)) });
  const newFile = () => setAsk({ title: "New file", label: "Name", initial: "untitled.txt", confirm: "Create", onSubmit: async (n) => (await os.fs.write(join(dir, n), ""), after(dir, n)) });
  const rename = () => selected && setAsk({ title: "Rename", label: "New name", initial: selected.name, confirm: "Rename", onSubmit: async (n) => (await os.fs.move(join(dir, selected.name), join(dir, n)), after(dir, n)) });
  const remove = () => selected && setAsk({ title: "Move to trash?", confirmDelete: selected });
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
    else if (e.key === "Backspace" || (e.altKey && e.key === "ArrowUp")) dir !== "/" && (e.preventDefault(), setDir(parent(dir)));
  };

  return (
    <div className="files" onKeyDown={onKey}>
      <Toolbar label="Files actions">
        <IconButton label="Up one folder" disabled={dir === "/"} onClick={() => setDir(parent(dir))}>⬆</IconButton>
        <div className="grow"><Breadcrumb path={dir} onNavigate={setDir} /></div>
        <Button onClick={newFolder}>New folder</Button>
        <Button onClick={newFile}>New file</Button>
        <Button disabled={!selected} onClick={rename}>Rename</Button>
        <Button variant="danger" disabled={!selected} onClick={remove}>Delete</Button>
      </Toolbar>

      <div className="split">
        <List
          label={`Contents of ${dir}`}
          items={entries}
          selected={selected}
          getKey={(e) => e.name}
          onSelect={setSelected}
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
        {preview && (
          <aside className="preview" aria-label={`Preview of ${preview.name}`}>
            <h3>{preview.name}</h3>
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

      {ask && "confirmDelete" in ask && (
        <Dialog
          title={ask.title}
          onClose={() => setAsk(null)}
          actions={
            <>
              <Button onClick={() => setAsk(null)}>Cancel</Button>
              <Button variant="danger" autoFocus onClick={() => (setAsk(null), os.fs.remove(join(dir, ask.confirmDelete.name)).then(() => after()).catch(fail))}>Move to trash</Button>
            </>
          }
        >
          <p>{ask.confirmDelete.name} will go to the trash.</p>
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

createRoot(document.getElementById("root")!).render(<Files />);
