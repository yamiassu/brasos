// Storybook stories for the UI kit (run: bun run storybook). Plain CSF objects: no Storybook types are needed here.
import { useState, type ReactNode } from "react";
import { Breadcrumb, Button, Dialog, Icon, iconNames, IconButton, IconTile, List, Menu, SearchField, Taskbar, TaskButton, TextField, Toolbar, Tray, TrayItem, WindowFrame } from "./index";
import "../../shell/src/shell.css"; // the desktop layout classes (.layer, .icons) used by the composition story

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section style={{ padding: 16, display: "grid", gap: 10 }}>
    <h3 style={{ margin: 0, fontSize: 12, color: "var(--muted)", fontWeight: 500, textTransform: "uppercase", letterSpacing: 1 }}>{title}</h3>
    {children}
  </section>
);
const Row = ({ children }: { children: ReactNode }) => <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{children}</div>;

export default { title: "UI kit" };

const swatch = (v: string) => (
  <div key={v} style={{ width: 120 }}>
    <div style={{ height: 44, borderRadius: 8, background: `var(${v})`, border: "1px solid var(--border)" }} />
    <code style={{ fontSize: 11, color: "var(--muted)" }}>{v}</code>
  </div>
);
export const Tokens = () => (
  <>
    <Section title="Neutral night (most of the screen)"><Row>{["--bg", "--panel", "--panel-2", "--text", "--muted", "--icon", "--icon-2"].map(swatch)}</Row></Section>
    <Section title="The rare colors (a signal: focus, selection, the primary action)"><Row>{["--accent", "--accent-2", "--danger", "--warn"].map(swatch)}</Row></Section>
    <Section title="Edges and fills"><Row>{["--border", "--border-strong", "--hover", "--selected"].map(swatch)}</Row></Section>
    <Section title="Gradient and glow">
      <Row>
        <div style={{ width: 200, height: 44, borderRadius: 8, background: "var(--aurora)" }} />
        <div style={{ width: 200, height: 44, borderRadius: 8, background: "var(--panel)", boxShadow: "var(--glow)" }} />
      </Row>
    </Section>
  </>
);

export const Buttons = () => (
  <Section title="Buttons">
    <Row>
      <Button>Default</Button>
      <Button variant="primary">Primary</Button>
      <Button variant="danger">Danger</Button>
      <Button variant="ghost">Ghost</Button>
      <Button disabled>Disabled</Button>
    </Row>
    <Row>
      <Button><Icon name="edit" size={18} /> With icon</Button>
      <IconButton label="Close">✕</IconButton>
    </Row>
  </Section>
);

export const Icons = () => (
  <Section title="Icons (hover a tile: the color lights up)">
    <Row>
      {iconNames.map((n) => (
        <div key={n} style={{ display: "grid", justifyItems: "center", gap: 4 }}>
          <IconTile icon={n} label={n} />
        </div>
      ))}
    </Row>
  </Section>
);

export const Fields = () => (
  <Section title="Fields, toolbar, breadcrumb">
    <TextField label="Name" defaultValue="notes.txt" />
    <Toolbar label="Demo">
      <Button>New folder</Button>
      <Button>Rename</Button>
      <span className="grow" />
      <Breadcrumb path="/Documents/projects" onNavigate={() => {}} />
    </Toolbar>
  </Section>
);

const rows = ["Desktop", "Documents", "Downloads", "notes.txt", "photo.png"];
export const Lists = () => {
  const [sel, setSel] = useState<string | null>("Documents");
  return (
    <Section title="List (keyboard: arrows, Home, End, Enter)">
      <div style={{ width: 320, border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
        <List label="Demo" items={rows} selected={sel} onSelect={setSel} getKey={(r) => r} render={(r) => <>{r}</>} />
      </div>
    </Section>
  );
};

export const MenuAndDialog = () => {
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState(false);
  return (
    <Section title="Menu and dialog">
      <Row>
        <Button onClick={() => setMenu(true)}>Open menu</Button>
        <Button onClick={() => setDialog(true)}>Open dialog</Button>
      </Row>
      {menu && <Menu x={40} y={140} onClose={() => setMenu(false)} items={[{ label: "Open" }, { label: "Rename" }, { label: "Delete", danger: true }].map((i) => ({ ...i, onSelect: () => {} }))} />}
      {dialog && (
        <Dialog title="Restart the interface?" onClose={() => setDialog(false)} actions={<><Button onClick={() => setDialog(false)}>Cancel</Button><Button variant="primary" onClick={() => setDialog(false)}>Restart</Button></>}>
          <p style={{ margin: 0 }}>The shell and every app are rebuilt. Open windows are closed.</p>
        </Dialog>
      )}
    </Section>
  );
};

export const Windows = () => (
  <div style={{ position: "relative", height: 460 }}>
    <WindowFrame title="Focused" icon="files" focused style={{ left: 40, top: 30 }} onClose={() => {}}>
      <div style={{ padding: 16 }}>The window with the user's attention glows.</div>
    </WindowFrame>
    <WindowFrame title="Unfocused" icon="docs" style={{ left: 360, top: 90 }} onClose={() => {}}>
      <div style={{ padding: 16 }}>The others stay grey.</div>
    </WindowFrame>
  </div>
);

// the whole desktop in one frame: icons, two windows, the dock
export const Desktop = () => (
  <div id="root" style={{ position: "relative", height: "100vh" }}>
    <div className="layer">
      <div className="icons">
        {["about", "browser", "docs", "files", "terminal", "crash"].map((n) => <IconTile key={n} icon={n} label={n[0].toUpperCase() + n.slice(1)} selected={n === "docs"} />)}
        <IconTile icon="text" label="hello.txt" />
        <IconTile icon="folder" label="Projects" />
      </div>
    </div>
    <div className="layer windows">
      <WindowFrame title="Files" icon="files" style={{ left: 200, top: 40 }} onClose={() => {}}><div style={{ padding: 16 }}>Files</div></WindowFrame>
      <WindowFrame title="Docs" icon="docs" focused style={{ left: 280, top: 110 }} onClose={() => {}}><div style={{ padding: 16 }}>Docs (focused)</div></WindowFrame>
    </div>
    <Taskbar>
      <TaskButton icon="start" label="Start" />
      <SearchField label="Search apps, files, guides" />
      {["about", "browser", "docs", "files", "terminal"].map((n) => <TaskButton key={n} icon={n} label={n} running={n !== "about"} active={n === "docs"} />)}
      <Tray>
        <TrayItem icon="edit" label="Edit the interface" onClick={() => {}} />
        <TrayItem icon="restart" label="Restart the interface" onClick={() => {}} />
        <TrayItem icon="dev" label="Development image">DEV · not secure</TrayItem>
        <TrayItem icon="network" label="Network: connected" />
        <TrayItem icon="battery" label="Battery 80%">80%</TrayItem>
        <TrayItem label="Clock"><span className="stack"><span>02:17</span><span>15/11/2026</span></span></TrayItem>
      </Tray>
    </Taskbar>
  </div>
);
