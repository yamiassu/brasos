import "@brasos/sdk";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

const term = new Terminal({ cursorBlink: true, fontSize: 14, theme: { background: "#0b0807" } });
const fit = new FitAddon();
term.loadAddon(fit);
term.open(document.getElementById("t")!);

const ws = new WebSocket(`ws://${location.host}/pty`);
ws.binaryType = "arraybuffer";
const send = (m: object) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));
const resize = () => {
  fit.fit();
  send({ t: "r", cols: term.cols, rows: term.rows });
};
ws.onopen = resize;
ws.onmessage = (e) => term.write(new Uint8Array(e.data));
ws.onclose = () => term.write("\r\n[session closed]");
term.onData((d) => send({ t: "i", d }));
new ResizeObserver(resize).observe(document.body);
term.focus();
addEventListener("focus", () => term.focus());
