// The desktop: an icon for every app, then whatever is in the user's /Desktop folder. Double-click or Enter opens.
// Icons can be dragged to any free cell of the grid, and an app's icon can be removed from the desktop (the app stays
// installed: it is still in Start and the taskbar). A file or folder can be moved to the trash (Delete) or deleted for good
// (Shift+Delete), after a confirmation. Where things are is kept by desktop-layout.ts.
import { useEffect, useRef, useState } from "react";
import type { AppInfo, FsEntry } from "@brasos/sdk";
import { Button, Dialog, IconTile, Menu, useMarquee, type MenuItem } from "@brasos/ui";
import { arrange, cellAt, CELL, loadLayout, nearestFree, pixel, rowsFor, saveLayout, type Layout } from "./desktop-layout";

const TEXT = /\.(txt|md|json|ts|tsx|js|css|html|csv|log|toml|ya?ml)$/i;
const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;
export const iconFor = (e: FsEntry) => (e.kind === "dir" ? "folder" : e.kind === "link" ? "link" : TEXT.test(e.name) ? "text" : IMAGE.test(e.name) ? "image" : "file");

const DRAG_START = 4; // px the pointer must travel before a press is a drag (a click or double click is not)

type Item = { key: string; icon: string; label: string; app?: AppInfo; path?: string; open(): void };

export function Desktop({ apps, entries, onOpenApp, onOpenPath, onRefresh, onDelete }: {
  apps: AppInfo[];
  entries: FsEntry[];
  onOpenApp(app: AppInfo): void;
  onOpenPath(path: string): void;
  onRefresh(): void;
  /** moves files and folders to the trash, or deletes them for good */
  onDelete?(paths: string[], forever: boolean): Promise<unknown>;
}) {
  const [ask, setAsk] = useState<{ paths: string[]; forever: boolean } | null>(null);
  const [selected, setSelected] = useState<string[]>([]); // a click picks one; a box (or Ctrl+click) picks several
  const [menu, setMenu] = useState<{ x: number; y: number; item?: Item } | null>(null);
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const [size, setSize] = useState({ w: 1000, h: 600 });
  const [moving, setMoving] = useState<{ key: string; left: number; top: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const dragged = useRef(false); // the click that ends a drag must not select or open
  const grab = useRef<{ key: string; x: number; y: number; left: number; top: number; moved: boolean } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const change = (l: Layout) => (setLayout(l), saveLayout(l));
  const items: Item[] = [
    ...apps.filter((a) => !layout.hidden.includes(a.id)).map((a): Item => ({ key: "app:" + a.id, icon: a.icon, label: a.name, app: a, open: () => onOpenApp(a) })),
    ...entries.map((e): Item => ({ key: "fs:" + e.name, icon: iconFor(e), label: e.name, path: "/Desktop/" + e.name, open: () => onOpenPath("/Desktop/" + e.name) })),
  ];
  const rows = rowsFor(size.h);
  const cells = arrange(items.map((i) => i.key), layout.cells, rows);

  // removing an icon from the desktop applies to every selected app icon when the one asked about is among them
  const remove = (it: Item) => {
    const gone = (selected.includes(it.key) ? items.filter((i) => selected.includes(i.key)) : [it]).flatMap((i) => (i.app ? [i.app.id] : []));
    if (!gone.length) return;
    setSelected([]);
    change({ ...layout, hidden: [...new Set([...layout.hidden, ...gone])] });
  };
  // deleting applies to every selected file and folder when the one asked about is among them
  const del = (it: Item, forever: boolean) => {
    const paths = (selected.includes(it.key) ? items.filter((i) => selected.includes(i.key)) : [it]).flatMap((i) => (i.path ? [i.path] : []));
    if (paths.length && onDelete) setAsk({ paths, forever });
  };
  const onKey = (e: React.KeyboardEvent, it: Item) => {
    if (e.key !== "Delete") return;
    if (it.path) del(it, e.shiftKey);
    else remove(it);
  };
  const marquee = useMarquee(setSelected, () => setSelected([]));

  const onUp = (e: React.PointerEvent, it: Item) => {
    const g = grab.current;
    grab.current = null;
    if (!g?.moved) return;
    const rect = box.current!.getBoundingClientRect();
    const want = cellAt(g.left + (e.clientX - g.x) + CELL / 2, g.top + (e.clientY - g.y) + CELL / 2, rows, Math.max(1, Math.floor(rect.width / CELL)));
    const others = Object.entries(cells).filter(([k]) => k !== it.key).map(([, c]) => c);
    change({ ...layout, cells: { ...cells, [it.key]: nearestFree(want, others, rows) } }); // the whole arrangement is kept, so nothing else moves
    setMoving(null);
  };

  const menuItems = (it?: Item): MenuItem[] =>
    it
      ? [
          { label: it.app ? `Open ${it.label}` : "Open", onSelect: it.open },
          ...(it.app ? [{ label: "Remove from desktop", onSelect: () => remove(it) }] : []),
          ...(it.path && onDelete
            ? [
                { label: "Move to trash", danger: true, onSelect: () => del(it, false) },
                { label: "Delete permanently", danger: true, onSelect: () => del(it, true) },
              ]
            : []),
        ]
      : [
          { label: "Open Files", onSelect: () => onOpenPath("/Desktop") },
          { label: "Refresh", onSelect: onRefresh },
          { label: "Arrange icons", onSelect: () => change({ ...layout, cells: {} }) },
          ...(layout.hidden.length ? [{ label: `Show removed apps (${layout.hidden.length})`, onSelect: () => change({ ...layout, hidden: [] }) }] : []),
        ];

  return (
    <div
      ref={box}
      className="icons"
      role="group"
      aria-label="Desktop"
      onPointerDown={marquee.onPointerDown}
      onContextMenu={(e) => (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY }))}
    >
      {items.map((it) => {
        const pos = moving?.key === it.key ? { left: moving.left, top: moving.top, zIndex: 3 } : pixel(cells[it.key]);
        return (
          <div
            key={it.key}
            data-key={it.key}
            className={"icon" + (moving?.key === it.key ? " dragging" : "")}
            style={pos}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              dragged.current = false;
              grab.current = { key: it.key, x: e.clientX, y: e.clientY, ...pixel(cells[it.key]), moved: false };
            }}
            onPointerMove={(e) => {
              const g = grab.current;
              if (!g || (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) < DRAG_START)) return;
              // captured only once it is a drag: a captured press would send the click and double click to this wrapper instead of the icon
              if (!g.moved) try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
              g.moved = dragged.current = true;
              if (!selected.includes(it.key)) setSelected([it.key]);
              setMoving({ key: it.key, left: g.left + e.clientX - g.x, top: g.top + e.clientY - g.y });
            }}
            onPointerUp={(e) => onUp(e, it)}
            onPointerCancel={() => (grab.current = null, setMoving(null))}
            onClickCapture={(e) => dragged.current && (dragged.current = false, e.stopPropagation())}
            onKeyDown={(e) => onKey(e, it)}
            onContextMenu={(e) => (e.preventDefault(), e.stopPropagation(), selected.includes(it.key) || setSelected([it.key]), setMenu({ x: e.clientX, y: e.clientY, item: it }))}
          >
            <IconTile icon={it.icon} label={it.label} selected={selected.includes(it.key)} onSelect={(e) => setSelected(e.ctrlKey || e.shiftKey ? (selected.includes(it.key) ? selected.filter((k) => k !== it.key) : [...selected, it.key]) : [it.key])} onOpen={it.open} />
          </div>
        );
      })}
      {marquee.box}
      {menu && <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={menuItems(menu.item)} />}
      {ask && (
        <Dialog
          title={ask.forever ? "Delete permanently?" : "Move to trash?"}
          onClose={() => setAsk(null)}
          actions={
            <>
              <Button onClick={() => setAsk(null)}>Cancel</Button>
              <Button variant="danger" autoFocus onClick={() => (setAsk(null), setSelected([]), onDelete?.(ask.paths, ask.forever))}>
                {ask.forever ? "Delete permanently" : "Move to trash"}
              </Button>
            </>
          }
        >
          <p>
            {ask.paths.length === 1 ? ask.paths[0].slice("/Desktop/".length) : `${ask.paths.length} items`}
            {ask.forever ? " will be deleted permanently. This can't be undone." : " will go to the trash."}
          </p>
        </Dialog>
      )}
    </div>
  );
}
