import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { os } from "@brasos/sdk";
import { Breadcrumb, Button, Dialog, Icon, IconButton, TextField, TitleBar } from "@brasos/ui";
import "@brasos/ui/ui.css";
import "./notes.css";
import { join, parent, validName } from "../files/paths";
import { Markdown, splitBlocks } from "./markdown";
import { canDrop, remap } from "./tree";

type Node = { name: string; path: string; dir: boolean; kids?: Node[] };
type Ask = { title: string; label: string; initial: string; confirm: string; run(v: string): Promise<unknown> };

type Settings = { root: string; fontSize: number; font: "sans" | "serif" | "mono"; width: number };
const DEFAULTS: Settings = { root: "/Notes", fontSize: 15, font: "sans", width: 720 };
const FONTS = { sans: "system-ui, sans-serif", serif: "Georgia, 'Times New Roman', serif", mono: "ui-monospace, monospace" };
const KEY = "notes.settings";
const stored = (): Settings => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
};
const parentOfPath = (p: string) => p.replace(/\/[^/]*$/, "") || "/";
const toText = (blocks: string[]) => blocks.filter((b) => b.trim()).join("\n\n");

async function walk(path: string, depth = 0): Promise<Node[]> {
  const list = await os.fs.list(path);
  const nodes = await Promise.all(
    list
      .filter((e) => (e.kind === "dir" && depth < 8) || (e.kind === "file" && /\.(md|markdown|txt)$/i.test(e.name)))
      .map(async (e): Promise<Node> => ({ name: e.name, path: join(path, e.name), dir: e.kind === "dir", kids: e.kind === "dir" ? await walk(join(path, e.name), depth + 1) : undefined })),
  );
  return nodes.sort((a, b) => +b.dir - +a.dir || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}

function Notes() {
  const [settings, setSettings] = useState(stored);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const dragPath = useRef<string | null>(null); // the file or folder being dragged in the tree
  const [dropOn, setDropOn] = useState<string | null>(null); // the folder (or root) it would land in
  const caretAt = useRef<"start" | "end">("end"); // where the caret goes when arrow keys move into another block
  const [hist, setHist] = useState({ stack: [] as string[], i: -1 }); // back and forward through opened notes
  const root = settings.root;
  const [tree, setTree] = useState<Node[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<Node | null>(null); // the selected file or folder
  const [file, setFile] = useState<string | null>(null); // the file being edited
  const [blocks, setBlocks] = useState<string[]>([""]);
  const [at, setAt] = useState<number | null>(null); // the block being edited; the others show rendered
  const [saved, setSaved] = useState("");
  const [readOnly, setReadOnly] = useState(false); // a truncated read must never be written back
  const [ask, setAsk] = useState<Ask | null>(null);
  const [status, setStatus] = useState("");
  const text = toText(blocks);
  const fail = (e: unknown) => setStatus((e as Error).message.replace(/^BrasOS [^:]*: \d+ /, "").replace(/^\{"error":"(.*)"\}$/, "$1"));

  const reload = useCallback(async () => {
    try {
      await os.fs.list(root).catch(() => os.fs.mkdir(root)); // the default folder is created on first use
      setTree(await walk(root));
    } catch (e) {
      fail(e);
    }
  }, [root]);
  useEffect(() => void reload(), [reload]);

  // autosave shortly after typing stops
  const latest = useRef({ file, text, saved, readOnly });
  latest.current = { file, text, saved, readOnly };
  useEffect(() => {
    if (!file || readOnly || text === saved) return;
    const t = setTimeout(() => os.fs.write(file, text).then(() => (setSaved(text), setStatus("Saved")), fail), 500);
    return () => clearTimeout(t);
  }, [file, text, saved, readOnly]);

  const flush = async () => {
    const { file: f, text: t, saved: s, readOnly: ro } = latest.current;
    if (f && !ro && t !== s) await os.fs.write(f, t);
  };
  const select = async (n: Node, push = true) => {
    setSel(n);
    if (n.dir) return setOpen((o) => (o.delete(n.path) || o.add(n.path), new Set(o)));
    try {
      await flush();
      const r = await os.fs.read(n.path);
      const b = splitBlocks(r.encoding === "utf8" ? r.content : "");
      setFile(n.path), setBlocks(b), setAt(b.length === 1 && !b[0] ? 0 : null), setSaved(toText(b)), setReadOnly(!!r.truncated || r.encoding !== "utf8");
      if (push) setHist((h) => ({ stack: [...h.stack.slice(0, h.i + 1), n.path], i: h.i + 1 }));
      setStatus(r.truncated ? "Too large to edit here: shown read-only" : "");
    } catch (e) {
      fail(e);
    }
  };

  const here = sel ? (sel.dir ? sel.path : parent(sel.path)) : root; // new items go beside the selection
  const create = (dir: boolean) =>
    setAsk({
      title: dir ? "New folder" : "New note",
      label: "Name",
      initial: dir ? "" : "untitled.md",
      confirm: "Create",
      run: async (n) => {
        const path = join(here, n);
        if (dir) await os.fs.mkdir(path);
        else await os.fs.write(path, "");
        setOpen((o) => new Set(o).add(here));
        await reload();
        if (!dir) select({ name: n, path, dir: false });
      },
    });
  const applySettings = async (s: Settings) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {}
    if (s.root !== root) (await flush(), setFile(null), setBlocks([""]), setSaved(""), setSel(null));
    setSettings(s);
  };

  // drop a dragged file or folder into a folder (or the notes folder itself)
  const moveTo = async (dir: string) => {
    const from = dragPath.current;
    dragPath.current = null;
    setDropOn(null);
    if (!from || !canDrop(from, dir)) return;
    const to = join(dir, from.split("/").pop()!);
    try {
      await flush();
      await os.fs.move(from, to);
      setFile((f) => (f ? remap(f, from, to) : f));
      setHist((h) => ({ ...h, stack: h.stack.map((x) => remap(x, from, to)) }));
      setSel(null);
      setOpen((o) => new Set(o).add(dir));
      await reload();
      setStatus(`Moved to ${dir}`);
    } catch (e) {
      fail(e);
    }
  };
  const over = (dir: string) => (e: React.DragEvent) => {
    if (!dragPath.current || !canDrop(dragPath.current, dir)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropOn(dir);
  };
  const drop = (dir: string) => (e: React.DragEvent) => (e.preventDefault(), e.stopPropagation(), void moveTo(dir));

  const row = (n: Node, depth: number): React.ReactNode => (
    <li key={n.path}>
      <button
        type="button"
        className={"row" + (dropOn === n.path ? " drop" : "")}
        draggable
        onDragStart={(e) => ((dragPath.current = n.path), (e.dataTransfer.effectAllowed = "move"), e.dataTransfer.setData("text/plain", n.path))}
        onDragEnd={() => ((dragPath.current = null), setDropOn(null))}
        {...(n.dir ? { onDragOver: over(n.path), onDrop: drop(n.path) } : { onDragOver: over(parentOfPath(n.path)), onDrop: drop(parentOfPath(n.path)) })}
        style={{ paddingLeft: 8 + depth * 14 }}
        aria-current={file === n.path || sel?.path === n.path ? "true" : undefined}
        aria-expanded={n.dir ? open.has(n.path) : undefined}
        onClick={() => select(n)}
      >
        <Icon name={n.dir ? "folder" : "text"} size={16} />
        <span>{n.name}</span>
      </button>
      {n.dir && open.has(n.path) && <ul>{n.kids?.length ? n.kids.map((k) => row(k, depth + 1)) : <li className="none" style={{ paddingLeft: 30 + depth * 14 }}>empty</li>}</ul>}
    </li>
  );

  // clicking the empty space under the last block edits the end of the note
  const toEnd = () => {
    if (readOnly) return;
    if (blocks.at(-1)) setBlocks([...blocks, ""]);
    setAt(blocks.at(-1) ? blocks.length : blocks.length - 1);
  };

  const step = (d: -1 | 1) => {
    const path = hist.stack[hist.i + d];
    if (path === undefined) return;
    setHist({ ...hist, i: hist.i + d });
    select({ name: path.split("/").pop()!, path, dir: false }, false);
  };
  // a crumb that is a folder inside the notes folder opens it in the tree
  const goTo = (path: string) => path !== file && path.startsWith(root) && select({ name: path.split("/").pop()!, path, dir: true });
  useEffect(() => void os.window.setTitle(file ? `${file.split("/").pop()} - Notes` : "Notes"), [file]);

  return (
    <div className="notes-app" style={{ "--fs": settings.fontSize + "px", "--ff": FONTS[settings.font], "--pw": settings.width + "px" } as React.CSSProperties}>
    <TitleBar window={os.window} title="Notes" icon="text">
      <IconButton label={sidebar ? "Hide sidebar" : "Show sidebar"} onClick={() => setSidebar(!sidebar)}>☰</IconButton>
      <IconButton label="Back" disabled={hist.i <= 0} onClick={() => step(-1)}>←</IconButton>
      <IconButton label="Forward" disabled={hist.i >= hist.stack.length - 1} onClick={() => step(1)}>→</IconButton>
      {file && <Breadcrumb path={file} onNavigate={goTo} />}
      <span className="ui-drag" />
      <IconButton label="Settings" onClick={() => setShowSettings(true)}><Icon name="settings" size={16} /></IconButton>
    </TitleBar>
    <div className="notes">
      {sidebar && <nav className="side" aria-label="Notes">
        <div className="head">
          <div className="actions">
            <Button onClick={() => create(false)}>New note</Button>
            <Button onClick={() => create(true)}>New folder</Button>
          </div>
          <div className="root" title={root}>{root}</div>
        </div>
        <ul className={"tree" + (dropOn === root ? " drop" : "")} onDragOver={over(root)} onDrop={drop(root)} onDragLeave={(e) => e.currentTarget === e.target && setDropOn(null)}>
          {tree.map((n) => row(n, 0))}
          {!tree.length && <li className="none">No notes yet.</li>}
        </ul>
      </nav>}
      <main className="main">
        {file ? (
          <div className="page" onClick={(e) => e.target === e.currentTarget && toEnd()}>
            {blocks.map((b, i) =>
              at === i && !readOnly ? (
                <BlockEditor
                  key={i}
                  value={b}
                  first={i === 0}
                  onChange={(v) => setBlocks((bs) => bs.map((x, j) => (j === i ? v : x)))}
                  onSplit={() => (setBlocks((bs) => [...bs.slice(0, i + 1), "", ...bs.slice(i + 1)]), setAt(i + 1))}
                  onRemove={() => (setBlocks((bs) => bs.filter((_, j) => j !== i)), setAt(i - 1))}
                  caret={caretAt.current}
                  onMove={(d) => i + d >= 0 && i + d < blocks.length && ((caretAt.current = d > 0 ? "start" : "end"), setAt(i + d))}
                  onBlur={() => setAt((a) => (a === i ? null : a))}
                />
              ) : (
                <div key={i} className="blk md" onClick={() => !readOnly && setAt(i)}>
                  {b.trim() ? <Markdown text={b} /> : <p className="ph">Type something...</p>}
                </div>
              ),
            )}
          </div>
        ) : (
          <p className="empty">Pick a note on the left, or create one.</p>
        )}
        <div className="status" role="status">
          {file ?? ""}
          {status && ` · ${status}`}
        </div>
      </main>
      {ask && <NameDialog ask={ask} onClose={() => setAsk(null)} onError={fail} />}
    </div>
      {showSettings && <SettingsDialog initial={settings} onClose={() => setShowSettings(false)} onSave={(s) => applySettings(s).catch(fail)} />}
    </div>
  );
}

/** one block as raw markdown: Enter at its end starts the next block (or the next list item), Backspace on an empty block removes it */
function BlockEditor({ value, first, caret, onChange, onSplit, onRemove, onMove, onBlur }: { value: string; first: boolean; caret: "start" | "end"; onChange(v: string): void; onSplit(): void; onRemove(): void; onMove(d: -1 | 1): void; onBlur(): void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => ref.current && ((ref.current.style.height = "0"), (ref.current.style.height = ref.current.scrollHeight + "px"));
  useEffect(() => {
    ref.current?.focus();
    const at = caret === "start" ? 0 : value.length;
    ref.current?.setSelectionRange(at, at);
  }, []);
  useEffect(() => void fit(), [value]);
  const key = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const v = e.currentTarget.value;
    if (e.key === "Backspace" && v === "" && !first) return e.preventDefault(), onRemove();
    // the arrow keys cross into the neighbouring block from its first or last line
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const { selectionStart: a, selectionEnd: b } = e.currentTarget;
      if (e.key === "ArrowUp" ? !v.slice(0, a).includes("\n") : !v.slice(b).includes("\n")) return e.preventDefault(), onMove(e.key === "ArrowUp" ? -1 : 1);
    }
    const atEnd = e.currentTarget.selectionStart === v.length;
    if (e.key !== "Enter" || e.shiftKey || !atEnd || (v.match(/^```/gm) || []).length % 2) return; // Shift+Enter, mid-text and open code fences: a plain newline
    e.preventDefault();
    const m = v.split("\n").at(-1)!.match(/^(\s*)([-*+]|\d+\.)\s(.*)$/);
    if (m && m[3]) onChange(v + "\n" + m[1] + (/\d/.test(m[2]) ? parseInt(m[2]) + 1 + "." : m[2]) + " ");
    else if (m) (onChange(v.replace(/\n?[^\n]*$/, "")), onSplit()); // Enter on an empty item ends the list
    else onSplit();
  };
  return <textarea ref={ref} className="blk edit" aria-label="Edit block" rows={1} spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={key} onBlur={onBlur} />;
}

function SettingsDialog({ initial, onClose, onSave }: { initial: Settings; onClose(): void; onSave(s: Settings): void }) {
  const [s, setS] = useState(initial);
  const [size, setSize] = useState(String(initial.fontSize));
  const px = Math.min(32, Math.max(10, Math.round(Number(size)) || 0));
  const ok = s.root.trim() !== "" && Number(size) >= 10 && Number(size) <= 32;
  const save = () => ok && (onClose(), onSave({ ...s, root: "/" + s.root.split("/").filter(Boolean).join("/"), fontSize: px }));
  return (
    <Dialog
      title="Settings"
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!ok} onClick={save}>Save</Button>
        </>
      }
    >
      <div className="settings">
        <TextField label="Notes folder (path in your home)" value={s.root} autoFocus onChange={(e) => setS({ ...s, root: e.target.value })} onKeyDown={(e) => e.key === "Enter" && save()} />
        <TextField label="Font size (px, 10 to 32)" type="number" min={10} max={32} value={size} onChange={(e) => setSize(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
        <label className="ui-field">
          Font
          <select value={s.font} onChange={(e) => setS({ ...s, font: e.target.value as Settings["font"] })}>
            <option value="sans">Sans-serif</option>
            <option value="serif">Serif</option>
            <option value="mono">Monospace</option>
          </select>
        </label>
        <label className="ui-field">
          Page width
          <select value={s.width} onChange={(e) => setS({ ...s, width: Number(e.target.value) })}>
            <option value={560}>Narrow</option>
            <option value={720}>Normal</option>
            <option value={960}>Wide</option>
            <option value={4000}>Full</option>
          </select>
        </label>
      </div>
    </Dialog>
  );
}

function NameDialog({ ask, onClose, onError }: { ask: Ask; onClose(): void; onError(e: unknown): void }) {
  const [v, setV] = useState(ask.initial);
  const ok = validName(v);
  const submit = () => ok && (onClose(), ask.run(v.trim()).catch(onError));
  return (
    <Dialog
      title={ask.title}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!ok} onClick={submit}>{ask.confirm}</Button>
        </>
      }
    >
      <TextField label={ask.label} value={v} autoFocus onFocus={(e) => e.currentTarget.select()} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
    </Dialog>
  );
}

const mount = document.getElementById("root");
if (mount) createRoot(mount).render(<Notes />);

export { Notes };
