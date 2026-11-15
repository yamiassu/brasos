import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Icon, iconNames, SearchField, Taskbar, TaskButton, Tray, TrayItem, Badge, Breadcrumb, Button, Dialog, Dock, IconButton, IconTile, List, Menu, splitPath, TextField, Toolbar, WindowFrame } from "../src";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

test("splitPath builds breadcrumbs from a virtual path", () => {
  expect(splitPath("/")).toEqual([{ name: "Home", path: "/" }]);
  expect(splitPath("/Documents/sub/")).toEqual([
    { name: "Home", path: "/" }, { name: "Documents", path: "/Documents" }, { name: "sub", path: "/Documents/sub" },
  ]);
  expect(splitPath("/x", "Files")[0].name).toBe("Files");
});

test("Breadcrumb is a labelled nav with the current page marked", () => {
  const m = html(<Breadcrumb path="/Documents/sub" onNavigate={() => {}} />);
  expect(m).toContain('<nav aria-label="Location"');
  expect(m.match(/aria-current="page"/g)?.length).toBe(1);
  expect(m).toContain(">Documents<");
});

test("buttons: variants map to classes and icon buttons are always labelled", () => {
  expect(html(<Button variant="primary">Go</Button>)).toContain("ui-btn ui-btn--primary");
  expect(html(<Button>Go</Button>)).toContain('class="ui-btn"');
  const icon = html(<IconButton label="Close window">✕</IconButton>);
  expect(icon).toContain('aria-label="Close window"');
  expect(icon).toContain('title="Close window"');
});

test("TextField ties its label to the input", () => {
  expect(html(<TextField label="Name" defaultValue="x" />)).toMatch(/<label class="ui-field">Name<input[^>]*value="x"/);
});

test("Toolbar has a role and a label", () => {
  expect(html(<Toolbar label="File actions">x</Toolbar>)).toContain('role="toolbar" aria-label="File actions"');
});

test("List is a listbox of options with the selection exposed", () => {
  const items = [{ id: "a" }, { id: "b" }];
  const m = html(<List items={items} selected={items[1]} onSelect={() => {}} render={(i) => i.id} getKey={(i) => i.id} label="Files" />);
  expect(m).toContain('role="listbox" aria-label="Files" tabindex="0"');
  expect(m.match(/role="option"/g)?.length).toBe(2);
  expect(m).toMatch(/role="option" aria-selected="false"[^>]*>a</);
  expect(m).toMatch(/role="option" aria-selected="true"[^>]*>b</);
});

test("IconTile is a focusable button with an accessible name; the glyph is decorative", () => {
  const m = html(<IconTile icon="folder" label="Documents" selected />);
  expect(m).toContain('aria-label="Documents"');
  expect(m).toContain('aria-selected="true"');
  expect(m).toContain('<span class="glyph" aria-hidden="true"><svg class="ui-icon"');
});

test("Menu and Dialog expose their roles", () => {
  const menu = html(<Menu x={10} y={20} onClose={() => {}} items={[{ label: "Open", onSelect() {} }, { label: "Delete", danger: true, onSelect() {} }]} />);
  expect(menu).toContain('role="menu"');
  expect(menu).toContain('left:10px;top:20px');
  expect(menu.match(/role="menuitem"/g)?.length).toBe(2);
  expect(menu).toContain('class="danger"');
  const dialog = html(<Dialog title="Delete file?" actions={<Button>OK</Button>} onClose={() => {}}>Sure?</Dialog>);
  expect(dialog).toContain('role="dialog" aria-modal="true" aria-label="Delete file?"');
});

test("WindowFrame, Dock and Badge: chrome with a labelled close button, a dock nav and a status", () => {
  const w = html(<WindowFrame title="Files" icon="files" focused onClose={() => {}}>body</WindowFrame>);
  expect(w).toContain("ui-window ui-window--focused");
  expect(w).toContain('aria-label="Files"');
  expect(w).toContain('aria-label="Close Files"');
  expect(w).toContain('<div class="body">body</div>');
  expect(html(<Dock>x</Dock>)).toContain('<nav aria-label="Dock" class="ui-dock">');
  expect(html(<Badge>dev</Badge>)).toContain('role="status"');
});

test("every class the components use is defined in ui.css (no unstyled component)", async () => {
  const css = await Bun.file(new URL("../src/ui.css", import.meta.url)).text();
  const src = await Bun.file(new URL("../src/components.tsx", import.meta.url)).text();
  for (const cls of new Set([...src.matchAll(/"(ui-[a-z-]+)/g)].map((m) => m[1]))) expect(css).toContain("." + cls);
});

test("Icon: every named icon draws; an unknown name (an emoji from an older manifest) is shown as text", () => {
  for (const n of iconNames) expect(html(<Icon name={n} />)).toContain("<svg");
  expect(html(<Icon name="🧩" />)).toContain("ui-icon-text");
});

test("Taskbar: apps report running and active, search is a labelled searchbox, the tray is a group", () => {
  const t = html(<Taskbar><TaskButton icon="files" label="Files" running active /><SearchField label="Search" /><Tray><TrayItem icon="network" label="Network: connected" /><TrayItem label="Clock">12:00</TrayItem></Tray></Taskbar>);
  expect(t).toContain('aria-label="Taskbar"');
  expect(t).toContain("ui-task ui-task--running ui-task--active");
  expect(t).toContain('aria-pressed="true"');
  expect(t).toMatch(/role="searchbox"[^>]*aria-label="Search"|aria-label="Search"[^>]*role="searchbox"/);
  expect(t).toContain('role="group" aria-label="System tray"');
  expect(t).toContain('aria-label="Network: connected"');
});
