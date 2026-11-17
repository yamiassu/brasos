// The Terminal's page: tabs, each its own xterm and its own PTY. The server side is unchanged: one WebSocket is one
// session (opened, audited and closed by apps/terminal/server.ts), so a tab is simply another connection.
import "@brasos/sdk";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { os } from "@brasos/sdk";
import { urlAt, urlOf } from "./links";
import "@xterm/xterm/css/xterm.css";
import "@brasos/ui/ui.css";
import "./terminal.css";

type Tab = { n: number; term: Terminal; fit: FitAddon; ws: WebSocket; pane: HTMLElement; btn: HTMLElement; label: HTMLElement; closed: boolean };

const bar = document.getElementById("bar")!;
const panes = document.getElementById("panes")!;
const add = document.getElementById("add")!;
const tabs: Tab[] = [];
let active: Tab | null = null;
let count = 0;

// the OS palette, so the terminal belongs to the rest of the interface
const theme = {
  background: "#0c0c0d", foreground: "#ececee", cursor: "#5fd39a", cursorAccent: "#0c0c0d", selectionBackground: "#5fd39a40",
  black: "#1a1a1c", red: "#f0616d", green: "#5fd39a", yellow: "#ecd28a", blue: "#6cb6ff", magenta: "#9b87f5", cyan: "#4fd1c5", white: "#c9c9cf",
  brightBlack: "#6b6b73", brightRed: "#ff8a93", brightGreen: "#8be8bc", brightYellow: "#f5e3a9", brightBlue: "#9ccfff", brightMagenta: "#b9a9ff", brightCyan: "#7fe6dc", brightWhite: "#ffffff",
};

function resize(t: Tab) {
  if (t.pane.offsetParent === null) return; // a hidden tab has no size to fit; it is fitted when shown
  t.fit.fit();
  if (t.ws.readyState === WebSocket.OPEN) t.ws.send(JSON.stringify({ t: "r", cols: t.term.cols, rows: t.term.rows }));
}

function show(t: Tab) {
  active = t;
  for (const o of tabs) {
    const on = o === t;
    o.pane.hidden = !on;
    o.btn.setAttribute("aria-selected", String(on));
    o.btn.tabIndex = on ? 0 : -1;
  }
  resize(t);
  t.term.focus();
}

function closeTab(t: Tab) {
  const i = tabs.indexOf(t);
  if (i < 0) return;
  tabs.splice(i, 1);
  t.ws.close();
  t.term.dispose();
  t.pane.remove();
  t.btn.remove();
  if (!tabs.length) newTab();
  else if (active === t) show(tabs[Math.min(i, tabs.length - 1)]);
}

function step(d: number) {
  if (active) show(tabs[(tabs.indexOf(active) + d + tabs.length) % tabs.length]);
}

function newTab() {
  const n = ++count;
  const term = new Terminal({ cursorBlink: true, fontSize: 14, scrollback: 5000, theme, fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace' });
  const fit = new FitAddon();
  term.loadAddon(fit);

  const pane = document.createElement("div");
  pane.className = "pane";
  pane.setAttribute("role", "tabpanel");
  panes.append(pane);
  term.open(pane);

  const btn = document.createElement("div");
  btn.className = "tab";
  btn.setAttribute("role", "tab");
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = `Terminal ${n}`;
  const x = document.createElement("button");
  x.className = "x";
  x.type = "button";
  x.setAttribute("aria-label", `Close ${label.textContent}`);
  x.textContent = "×";
  btn.append(label, x);
  bar.insertBefore(btn, add);

  const ws = new WebSocket(`ws://${location.host}/pty`);
  ws.binaryType = "arraybuffer";
  const t: Tab = { n, term, fit, ws, pane, btn, label, closed: false };
  tabs.push(t);

  ws.onopen = () => resize(t);
  ws.onmessage = (e) => term.write(new Uint8Array(e.data));
  ws.onclose = () => {
    t.closed = true;
    btn.classList.add("closed");
    if (tabs.includes(t)) term.write("\r\n\x1b[90m[session closed]\x1b[0m");
  };
  term.onData((d) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ t: "i", d })));
  term.onTitleChange((title) => {
    label.textContent = title.trim().slice(0, 28) || `Terminal ${n}`;
    x.setAttribute("aria-label", `Close ${label.textContent}`);
  });

  btn.addEventListener("click", (e) => (e.target === x ? closeTab(t) : show(t)));
  btn.addEventListener("auxclick", (e) => e.button === 1 && closeTab(t)); // middle click closes, like a browser tab
  btn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") (e.preventDefault(), show(t));
    else if (e.key === "ArrowRight") (e.preventDefault(), step(1), active?.btn.focus());
    else if (e.key === "ArrowLeft") (e.preventDefault(), step(-1), active?.btn.focus());
    else if (e.key === "Delete") closeTab(t);
  });

  // Copy: Ctrl+C copies when something is selected (otherwise it is the usual interrupt), Ctrl+Shift+C always copies.
  // Paste is the browser's own Ctrl+V or Ctrl+Shift+V (the key handler below lets it through). Ctrl+click, or Ctrl+right-click, on a web address (or on a selected one) opens it in the browser app.
  const copy = () => {
    const text = term.getSelection();
    if (!text) return false;
    (navigator.clipboard?.writeText(text) ?? Promise.reject()).catch(() => {
      const a = document.createElement("textarea"); // a frame without the clipboard permission: the older way
      a.value = text;
      document.body.append(a);
      a.select();
      document.execCommand("copy");
      a.remove();
      term.focus();
    });
    return true;
  };
  const openAt = (e: MouseEvent) => {
    let url = urlOf(term.getSelection());
    if (!url) {
      const screen = pane.querySelector(".xterm-screen")?.getBoundingClientRect();
      if (!screen) return;
      const col = Math.floor(((e.clientX - screen.left) / screen.width) * term.cols);
      const row = Math.floor(((e.clientY - screen.top) / screen.height) * term.rows);
      const buf = term.buffer.active;
      url = urlAt(buf.getLine(buf.viewportY + row)?.translateToString(true) ?? "", col);
    }
    if (url) (e.preventDefault(), void os.apps.open("browser", { url }));
  };
  pane.addEventListener("contextmenu", (e) => e.ctrlKey && (e.preventDefault(), openAt(e)));
  pane.addEventListener("click", (e) => e.ctrlKey && !e.shiftKey && openAt(e));

  // Ctrl+Shift+T new tab, Ctrl+Shift+W close it, Ctrl+Shift+Left/Right switch. Plain Ctrl keys stay with the shell program.
  term.attachCustomKeyEventHandler((e) => {
    if (e.type === "keydown" && e.ctrlKey && !e.altKey && e.code === "KeyC" && (e.shiftKey || term.hasSelection())) return !copy(); // handled: not sent to the program
    // Paste: leave Ctrl+V / Ctrl+Shift+V to the browser (xterm would otherwise take the key as ^V and cancel the paste event)
    if (e.ctrlKey && !e.altKey && e.code === "KeyV") return false;
    if (e.type !== "keydown" || !e.ctrlKey || !e.shiftKey) return true;
    const run = { KeyT: newTab, KeyW: () => closeTab(t), ArrowLeft: () => step(-1), ArrowRight: () => step(1) }[e.code];
    if (!run) return true;
    e.preventDefault();
    run();
    return false;
  });

  show(t);
}

add.addEventListener("click", newTab);
new ResizeObserver(() => active && resize(active)).observe(panes);
addEventListener("focus", () => active?.term.focus());
newTab();
