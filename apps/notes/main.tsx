import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { os } from "@brasos/sdk";
import { Button, Dialog, Icon, IconButton, Menu, TextField, TitleBar } from "@brasos/ui";
import "@brasos/ui/ui.css";
import "./notes.css";
import { join, parent, validName } from "../files/paths";
import { Markdown, moveLine, splitBlocks, toggleTask } from "./markdown";
import { canDrop, remap } from "./tree";
import { caretBox, posNear } from "./caret";

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
  const caretAt = useRef<{ x: number; dir: -1 | 1 } | null>(null); // the horizontal position to keep when an arrow key moves into another block
  const [editing, setEditing] = useState<string | null>(null); // the tree row being renamed
  const skipRename = useRef(false);
  const [menu, setMenu] = useState<{ n: Node; x: number; y: number } | null>(null); // the tree's right-click menu
  const [trashing, setTrashing] = useState<Node | null>(null); // the entry awaiting delete confirmation
  const startAt = useRef<number | null>(null); // where the caret goes in a block made by Enter (after its list marker)
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
  useEffect(() => void (startAt.current = null), [at]); // one-shot: only the block Enter just made uses it
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

  // rename in place (double click a row); a file keeps a note extension so it stays in the list
  const rename = async (n: Node, raw: string) => {
    setEditing(null);
    let name = raw.trim();
    if (!name || name === n.name) return;
    if (!validName(name)) return fail(new Error("That name can't be used"));
    if (!n.dir && !/\.(md|markdown|txt)$/i.test(name)) name += ".md";
    const dir = parentOfPath(n.path);
    const to = join(dir, name);
    try {
      if ((await os.fs.list(dir)).some((e) => e.name === name)) return fail(new Error(`"${name}" already exists`));
      await flush();
      await os.fs.move(n.path, to);
      setFile((f) => (f ? remap(f, n.path, to) : f));
      setHist((h) => ({ ...h, stack: h.stack.map((x) => remap(x, n.path, to)) }));
      setOpen((o) => new Set([...o].map((p) => remap(p, n.path, to))));
      setSel(null);
      await reload();
    } catch (e) {
      fail(e);
    }
  };

  // delete = the files' trash (/.trash), after a confirmation
  const trash = async (n: Node) => {
    setTrashing(null);
    const inside = (p: string) => p === n.path || p.startsWith(n.path + "/");
    try {
      if (file && inside(file)) (setFile(null), setBlocks([""]), setSaved("")); // clear first so autosave can't recreate it
      else await flush();
      await os.fs.remove(n.path);
      setHist((h) => { const stack = h.stack.filter((p) => !inside(p)); return { stack, i: stack.length - 1 }; });
      setSel(null);
      await reload();
    } catch (e) {
      fail(e);
    }
  };

  const kids = (n: Node, depth: number) =>
    n.dir && open.has(n.path) && <ul>{n.kids?.length ? n.kids.map((k) => row(k, depth + 1)) : <li className="none" style={{ paddingLeft: 30 + depth * 14 }}>empty</li>}</ul>;
  const row = (n: Node, depth: number): React.ReactNode =>
    editing === n.path ? (
      <li key={n.path}>
        <div className="row" style={{ paddingLeft: 8 + depth * 14 }}>
          <Icon name={n.dir ? "folder" : "text"} size={16} />
          <input
            className="rename"
            ref={(el) => el?.focus()}
            defaultValue={n.name}
            aria-label="Name"
            onFocus={(e) => e.currentTarget.setSelectionRange(0, n.name.replace(/\.(md|markdown|txt)$/i, "").length)}
            onKeyDown={(e) => (e.key === "Enter" ? e.currentTarget.blur() : e.key === "Escape" && ((skipRename.current = true), e.currentTarget.blur()))}
            onBlur={(e) => (skipRename.current ? ((skipRename.current = false), setEditing(null)) : void rename(n, e.currentTarget.value))}
          />
        </div>
        {kids(n, depth)}
      </li>
    ) : (
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
        onDoubleClick={() => setEditing(n.path)}
        onContextMenu={(e) => (e.preventDefault(), setMenu({ n, x: e.clientX, y: e.clientY }))}
      >
        <Icon name={n.dir ? "folder" : "text"} size={16} />
        <span>{n.name}</span>
      </button>
      {kids(n, depth)}
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
  useEffect(() => void os.window.setTitle(file ? `${file.split("/").pop()} - Notes` : "Notes"), [file]);

  return (
    <div className="notes-app" style={{ "--fs": settings.fontSize + "px", "--ff": FONTS[settings.font], "--pw": settings.width + "px" } as React.CSSProperties}>
    <TitleBar window={os.window} title="Notes" icon="text">
      <IconButton label={sidebar ? "Hide sidebar" : "Show sidebar"} onClick={() => setSidebar(!sidebar)}>☰</IconButton>
      <IconButton label="Back" disabled={hist.i <= 0} onClick={() => step(-1)}>←</IconButton>
      <IconButton label="Forward" disabled={hist.i >= hist.stack.length - 1} onClick={() => step(1)}>→</IconButton>
      {file && <span className="file-name">{file.split("/").pop()}</span>}
      <span className="ui-drag" />
      <IconButton label="Settings" onClick={() => setShowSettings(true)}><Icon name="settings" size={16} /></IconButton>
    </TitleBar>
    <div className="notes">
      {sidebar && <nav className="side" aria-label="Notes">
        <div className="head">
          <div className="actions">
            <Button onClick={() => create(false)}><Icon name="plus" size={16} />New note</Button>
            <IconButton label="New folder" onClick={() => create(true)}><Icon name="folder" size={18} /></IconButton>
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
                  onChange={(v) => {
                    const parts = v.includes("\n") ? splitBlocks(v) : [v]; // pasted lines become entries; a code fence stays one
                    setBlocks((bs) => [...bs.slice(0, i), ...parts, ...bs.slice(i + 1)]);
                    if (parts.length > 1) (caretAt.current = null, startAt.current = null, setAt(i + parts.length - 1));
                  }}
                  onSplit={(before, after, col) => (setBlocks((bs) => [...bs.slice(0, i), before, after, ...bs.slice(i + 1)]), (startAt.current = col), setAt(i + 1))}
                  start={at === i ? startAt.current : null}
                  onRemove={() => (setBlocks((bs) => bs.filter((_, j) => j !== i)), setAt(i - 1))}
                  caret={at === i ? caretAt.current : null}
                  onMove={(d, x) => i + d >= 0 && i + d < blocks.length && ((caretAt.current = { x, dir: d }), setAt(i + d))}
                  onSwap={(d) => i + d >= 0 && i + d < blocks.length && (setBlocks((bs) => { const c = [...bs]; [c[i], c[i + d]] = [c[i + d], c[i]]; return c; }), setAt(i + d))}
                  onBlur={() => setAt((a) => (a === i ? null : a))}
                />
              ) : (
                <div key={i} className="blk md" onClick={() => !readOnly && setAt(i)}>
                  {b.trim() ? <Markdown text={b} onToggle={readOnly ? undefined : (l) => setBlocks((bs) => bs.map((x, j) => (j === i ? toggleTask(x, l) : x)))} /> : <p className="ph">{i === blocks.findLastIndex((x) => !x.trim()) ? "Type something..." : " "}</p>}
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
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: "Rename", onSelect: () => setTimeout(() => setEditing(menu.n.path)) }, // after the menu has closed and let go of focus
            { label: "Move to trash", danger: true, onSelect: () => setTrashing(menu.n) },
          ]}
        />
      )}
      {trashing && (
        <Dialog
          title="Move to trash?"
          onClose={() => setTrashing(null)}
          actions={
            <>
              <Button onClick={() => setTrashing(null)}>Cancel</Button>
              <Button variant="danger" autoFocus onClick={() => void trash(trashing)}>Move to trash</Button>
            </>
          }
        >
          <p>{trashing.name}{trashing.dir ? " and everything in it" : ""} will go to the trash.</p>
        </Dialog>
      )}
      {ask && <NameDialog ask={ask} onClose={() => setAsk(null)} onError={fail} />}
    </div>
      {showSettings && <SettingsDialog initial={settings} onClose={() => setShowSettings(false)} onSave={(s) => applySettings(s).catch(fail)} />}
    </div>
  );
}

/** one entry (a single line, or a code fence) as raw markdown: Enter starts the next entry (continuing a list or task), Backspace on an empty one removes it */
function BlockEditor({ value, first, caret, start, onChange, onSplit, onRemove, onMove, onSwap, onBlur }: { value: string; first: boolean; caret: { x: number; dir: -1 | 1 } | null; start: number | null; onChange(v: string): void; onSplit(before: string, after: string, col: number): void; onRemove(): void; onMove(d: -1 | 1, x: number): void; onSwap(d: -1 | 1): void; onBlur(): void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => ref.current && ((ref.current.style.height = "0"), (ref.current.style.height = ref.current.scrollHeight + "px"));
  useEffect(() => {
    ref.current?.focus();
    const ta = ref.current;
    if (!ta) return;
    const at = start !== null ? start : caret ? posNear(ta, caret.x, caret.dir) : value.length;
    ta.setSelectionRange(at, at);
  }, []);
  const caretPos = useRef<number | null>(null); // where to put the caret after a line move re-renders the text
  useEffect(() => {
    fit();
    if (caretPos.current !== null) (ref.current?.setSelectionRange(caretPos.current, caretPos.current), (caretPos.current = null));
  }, [value]);
  const key = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const v = e.currentTarget.value;
    if (e.key === "Backspace" && v === "" && !first) return e.preventDefault(), onRemove();
    // Alt+Up/Down moves the line; at the block's first or last line the whole block swaps with its neighbour
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const d = e.key === "ArrowUp" ? -1 : 1;
      const r = moveLine(v, e.currentTarget.selectionStart, d);
      if (r) (caretPos.current = r.pos, onChange(r.text));
      else onSwap(d);
      return;
    }
    // the arrow keys cross into the neighbouring block from its first or last line
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const ta = e.currentTarget;
      const up = e.key === "ArrowUp";
      const here = caretBox(ta, up ? ta.selectionStart : ta.selectionEnd);
      // on the first (Up) or last (Down) visual line of the block: go to the neighbour, keeping the horizontal position
      if (here.top === caretBox(ta, up ? 0 : v.length).top) return e.preventDefault(), onMove(up ? -1 : 1, here.left);
    }
    if (e.key !== "Enter") return;
    const pos = e.currentTarget.selectionStart;
    const before = v.slice(0, pos);
    if ((before.match(/^```/gm) || []).length % 2) return; // inside a code fence: a plain newline
    e.preventDefault(); // an entry is one line: Enter always starts the next one, with what follows the caret
    const after = v.slice(e.currentTarget.selectionEnd);
    const m = before.match(/^(\s*)(?:([-*+]|\d+\.)\s)?(\[[ xX]?\]\s)?(.*)$/)!;
    if (!m[2] && !m[3]) return onSplit(before, after, 0);
    if (!m[4].trim() && !after) return onChange(""); // Enter on an empty item ends the list
    const prefix = m[1] + (m[2] ? (/\d/.test(m[2]) ? parseInt(m[2]) + 1 + "." : m[2]) + " " : "") + (m[3] ? "[ ] " : "");
    onSplit(before, prefix + after, prefix.length);
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
