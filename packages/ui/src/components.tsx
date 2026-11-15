// @brasos/ui: the basic components for building an OS interface. Plain React, no runtime dependencies, styled by ui.css tokens.
// Accessibility is part of each component (roles, labels, keyboard), not an extra.
import {
  type ButtonHTMLAttributes, type CSSProperties, type HTMLAttributes, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type Ref,
  useEffect, useRef,
} from "react";

import { Icon } from "./icons";
import type { SelectHTMLAttributes } from "react";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

export function Button({ variant = "default", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "danger" | "ghost" }) {
  return <button type="button" {...p} className={cx("ui-btn", variant !== "default" && `ui-btn--${variant}`, className)} />;
}

/** A button with only an icon: the label is required because it is what screen readers and agents see */
export function IconButton({ label, children, className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" {...p} aria-label={label} title={label} className={cx("ui-btn", "ui-iconbtn", className)}>
      {children}
    </button>
  );
}

export function TextField({ label, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="ui-field">
      {label}
      <input {...p} />
    </label>
  );
}

export function Toolbar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="toolbar" aria-label={label} className="ui-toolbar">
      {children}
    </div>
  );
}

/** "/Documents/sub" -> [{name:"Home", path:"/"}, {name:"Documents", path:"/Documents"}, {name:"sub", path:"/Documents/sub"}] */
export function splitPath(path: string, rootName = "Home") {
  const parts = path.split("/").filter(Boolean);
  return [{ name: rootName, path: "/" }, ...parts.map((name, i) => ({ name, path: "/" + parts.slice(0, i + 1).join("/") }))];
}

export function Breadcrumb({ path, onNavigate, rootName }: { path: string; onNavigate(path: string): void; rootName?: string }) {
  const crumbs = splitPath(path, rootName);
  return (
    <nav aria-label="Location" className="ui-crumbs">
      {crumbs.map((c, i) => (
        <span key={c.path} style={{ display: "contents" }}>
          {i > 0 && <span className="sep" aria-hidden="true">/</span>}
          <Button variant="ghost" onClick={() => onNavigate(c.path)} aria-current={i === crumbs.length - 1 ? "page" : undefined}>
            {c.name}
          </Button>
        </span>
      ))}
    </nav>
  );
}

/**
 * A keyboard-navigable list: Up/Down/Home/End move the selection, Enter opens, double-click opens. One tab stop (the list).
 * Items are rendered by `render`; `selected` is controlled by the parent.
 */
export function List<T>({ items, selected, onSelect, onOpen, render, getKey, label, style }: {
  items: T[];
  selected: T | null;
  onSelect(item: T): void;
  onOpen?(item: T): void;
  render(item: T): ReactNode;
  getKey(item: T): string;
  label: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const index = selected ? items.findIndex((i) => getKey(i) === getKey(selected)) : -1;
  useEffect(() => {
    ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [index]);

  const onKey = (e: KeyboardEvent) => {
    const go = (i: number) => (e.preventDefault(), items[i] && onSelect(items[i]));
    if (e.key === "ArrowDown") go(Math.min(items.length - 1, index + 1));
    else if (e.key === "ArrowUp") go(Math.max(0, index < 0 ? 0 : index - 1));
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "Enter" && selected) (e.preventDefault(), onOpen?.(selected));
  };
  return (
    <div ref={ref} role="listbox" aria-label={label} tabIndex={0} className="ui-list" style={style} onKeyDown={onKey}>
      {items.map((item) => (
        <div
          key={getKey(item)}
          role="option"
          aria-selected={!!selected && getKey(item) === getKey(selected)}
          className="ui-item"
          onClick={() => onSelect(item)}
          onDoubleClick={() => onOpen?.(item)}
        >
          {render(item)}
        </div>
      ))}
    </div>
  );
}

/** A glyph with a label: desktop icons and file grids. A button, so it is focusable; Enter or double-click opens. */
export function IconTile({ icon, label, selected, onSelect, onOpen }: { icon: ReactNode; label: string; selected?: boolean; onSelect?(): void; onOpen?(): void }) {
  return (
    <button
      type="button"
      className="ui-tile"
      aria-selected={!!selected}
      aria-label={label}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), onOpen?.())}
    >
      <span className="glyph" aria-hidden="true">{typeof icon === "string" ? <Icon name={icon} size={36} /> : icon}</span>
      <span className="label">{label}</span>
    </button>
  );
}

export type MenuItem = { label: string; onSelect(): void; danger?: boolean };

/** A context menu at (x, y). Closes on Escape or a click anywhere else. */
export function Menu({ items, x, y, onClose }: { items: MenuItem[]; x: number; y: number; onClose(): void }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <div className="ui-backdrop" onClick={onClose} onContextMenu={(e) => (e.preventDefault(), onClose())} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div role="menu" className="ui-menu" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
        {items.map((it, i) => (
          <button key={it.label} ref={i === 0 ? first : undefined} role="menuitem" className={it.danger ? "danger" : undefined} onClick={() => (it.onSelect(), onClose())}>
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A modal dialog. Escape or a click on the backdrop closes it; put the primary action last. */
export function Dialog({ title, children, actions, onClose }: { title: string; children?: ReactNode; actions: ReactNode; onClose(): void }) {
  return (
    <div className="ui-backdrop ui-backdrop--dim" onClick={onClose} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="ui-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
        <div className="actions">{actions}</div>
      </div>
    </div>
  );
}

/** Window chrome (title bar and body). Dragging and focus are the shell's business: pass pointer handlers in `headerProps`. */
export function WindowFrame({ title, icon, focused, onClose, headerProps, style, children }: {
  title: string;
  /** the window with the user's attention glows brighter */
  focused?: boolean;
  icon?: ReactNode;
  onClose(): void;
  headerProps?: HTMLAttributes<HTMLElement>;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <section className={cx("ui-window", focused && "ui-window--focused")} style={style} aria-label={title}>
      <header {...headerProps}>
        <span className="title">{typeof icon === "string" ? <Icon name={icon} size={18} /> : icon} {title}</span>
        <IconButton label={`Close ${title}`} onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>✕</IconButton>
      </header>
      <div className="body">{children}</div>
    </section>
  );
}

export function Dock({ children }: { children: ReactNode }) {
  return <nav aria-label="Dock" className="ui-dock">{children}</nav>;
}

export function Badge({ children }: { children: ReactNode }) {
  return <span className="ui-badge" role="status">{children}</span>;
}

/** The bottom bar: a start button and search on the left, running apps in the middle, a system tray on the right. Put them as children, in that order. */
export function Taskbar({ children }: { children: ReactNode }) {
  return <nav aria-label="Taskbar" className="ui-taskbar">{children}</nav>;
}

/** An app on the taskbar: lit when it has windows, brighter when its window has the focus. */
export function TaskButton({ icon, label, running, active, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string; running?: boolean; active?: boolean }) {
  return (
    <button type="button" {...p} aria-label={label} title={label} aria-pressed={!!active} className={cx("ui-task", running && "ui-task--running", active && "ui-task--active")}>
      <Icon name={icon} size={22} />
    </button>
  );
}

/** A search box with a magnifier. The input is a `searchbox` so assistive tech (and agents) can find it. */
export function SearchField({ label, className, ref, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: string; ref?: Ref<HTMLInputElement> }) {
  return (
    <label className={cx("ui-search", className)}>
      <Icon name="search" size={16} />
      <input ref={ref} type="search" role="searchbox" aria-label={label} placeholder={label} autoComplete="off" spellCheck={false} {...p} />
    </label>
  );
}

/** The right side of the taskbar: status items and the clock. */
export function Tray({ children }: { children: ReactNode }) {
  return <div role="group" aria-label="System tray" className="ui-tray">{children}</div>;
}

/** One status item: an icon and/or text, with a tooltip. Clickable when `onClick` is given. */
export function TrayItem({ icon, label, children, onClick }: { icon?: string; label: string; children?: ReactNode; onClick?(): void }) {
  const inner = <>{icon && <Icon name={icon} size={16} />}{children}</>;
  return onClick ? (
    <button type="button" className="ui-tray-item" aria-label={label} title={label} onClick={onClick}>{inner}</button>
  ) : (
    <span className="ui-tray-item" role="status" aria-label={label} title={label}>{inner}</span>
  );
}

/** A labelled drop-down. Pass `<option>`s as children. */
export function SelectField({ label, children, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <label className="ui-field">
      {label}
      <select {...p}>{children}</select>
    </label>
  );
}
