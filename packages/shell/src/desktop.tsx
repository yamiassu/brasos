// The desktop: an icon for every app, then whatever is in the user's /Desktop folder. Double-click or Enter opens.
// Icons can be dragged to any free cell of the grid, and an app's icon can be removed from the desktop (the app stays
// installed: it is still in Start and the taskbar). Where things are is kept by desktop-layout.ts.
import { useEffect, useRef, useState } from "react";
import type { AppInfo, FsEntry } from "@brasos/sdk";
import { IconTile, Menu, type MenuItem } from "@brasos/ui";
import { arrange, cellAt, CELL, loadLayout, nearestFree, pixel, rowsFor, saveLayout, type Layout } from "./desktop-layout";

const TEXT = /\.(txt|md|json|ts|tsx|js|css|html|csv|log|toml|ya?ml)$/i;
const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;
export const iconFor = (e: FsEntry) => (e.kind === "dir" ? "folder" : e.kind === "link" ? "link" : TEXT.test(e.name) ? "text" : IMAGE.test(e.name) ? "image" : "file");

const DRAG_START = 4; // px the pointer must travel before a press is a drag (a click or double click is not)

type Item = { key: string; icon: string; label: string; app?: AppInfo; open(): void };

export function Desktop({ apps, entries, onOpenApp, onOpenPath, onRefresh }: {
  apps: AppInfo[];
  entries: FsEntry[];
  onOpenApp(app: AppInfo): void;
  onOpenPath(path: string): void;
  onRefresh(): void;
}) {
  const [selected, setSelected] = useState("");
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
    ...entries.map((e): Item => ({ key: "fs:" + e.name, icon: iconFor(e), label: e.name, open: () => onOpenPath("/Desktop/" + e.name) })),
  ];
  const rows = rowsFor(size.h);
  const cells = arrange(items.map((i) => i.key), layout.cells, rows);

  const remove = (it: Item) => it.app && (setSelected(""), change({ ...layout, hidden: [...new Set([...layout.hidden, it.app.id])] }));

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
      ? [{ label: it.app ? `Open ${it.label}` : "Open", onSelect: it.open }, ...(it.app ? [{ label: "Remove from desktop", onSelect: () => remove(it) }] : [])]
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
      onPointerDown={(e) => e.target === e.currentTarget && setSelected("")}
      onContextMenu={(e) => (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY }))}
    >
      {items.map((it) => {
        const pos = moving?.key === it.key ? { left: moving.left, top: moving.top, zIndex: 3 } : pixel(cells[it.key]);
        return (
          <div
            key={it.key}
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
              setSelected(it.key);
              setMoving({ key: it.key, left: g.left + e.clientX - g.x, top: g.top + e.clientY - g.y });
            }}
            onPointerUp={(e) => onUp(e, it)}
            onPointerCancel={() => (grab.current = null, setMoving(null))}
            onClickCapture={(e) => dragged.current && (dragged.current = false, e.stopPropagation())}
            onKeyDown={(e) => e.key === "Delete" && remove(it)}
            onContextMenu={(e) => (e.preventDefault(), e.stopPropagation(), setSelected(it.key), setMenu({ x: e.clientX, y: e.clientY, item: it }))}
          >
            <IconTile icon={it.icon} label={it.label} selected={selected === it.key} onSelect={() => setSelected(it.key)} onOpen={it.open} />
          </div>
        );
      })}
      {menu && <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={menuItems(menu.item)} />}
    </div>
  );
}
