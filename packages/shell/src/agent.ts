// The shell's agent interface: a handful of UI tools, offered two ways from the same definitions:
//  - to AI agents through the host's MCP endpoint (the shell connects a WebSocket and the host relays calls to it), and
//  - to the browser's own agent through WebMCP, when the browser has it (via the SDK's best-effort adapter).
// The tools only do what a user could do by clicking (focus, close, open); they never touch the server's capabilities.
import { os, type ToolDef } from "@brasos/sdk";

export type ShellApi = {
  snapshot(): unknown;
  focus(id: number): boolean;
  close(id: number): boolean;
  open(app: string, path?: string): Promise<boolean>;
};

export function shellTools(api: () => ShellApi): ToolDef[] {
  return [
    {
      name: "ui_snapshot",
      description: "The state of the screen in one call: open windows (id, app, title, which is focused), the apps that can be opened, and the desktop icons. Call this first instead of taking a screenshot.",
      inputSchema: { type: "object" },
      readOnly: true,
      execute: () => api().snapshot(),
    },
    {
      name: "windows_focus",
      description: "Bring a window to the front. Use the id from ui_snapshot.",
      inputSchema: { type: "object", properties: { id: { type: "integer", description: "window id" } }, required: ["id"] },
      execute: (a: { id: number }) => ({ ok: api().focus(a.id) }),
    },
    {
      name: "windows_close",
      description: "Close a window. Anything unsaved in it is lost.",
      inputSchema: { type: "object", properties: { id: { type: "integer", description: "window id" } }, required: ["id"] },
      execute: (a: { id: number }) => ({ ok: api().close(a.id) }),
    },
    {
      name: "apps_open",
      description: "Open an app in a new window. For Files, `path` opens it at that folder or file (e.g. /Documents). Use the app id from ui_snapshot.",
      inputSchema: { type: "object", properties: { app: { type: "string", description: "app id, e.g. files" }, path: { type: "string" } }, required: ["app"] },
      execute: async (a: { app: string; path?: string }) => ({ ok: await api().open(a.app, a.path) }),
    },
  ];
}

/** Offer the tools to WebMCP and keep a WebSocket to the host so agents using MCP can call them. Returns a disconnect function. */
export function connectAgent(api: () => ShellApi): () => void {
  const tools = shellTools(api);
  const unregister = tools.map((t) => os.tools.register(t));
  let ws: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let delay = 3000;
  let stopped = false;

  const connect = () => {
    ws = new WebSocket(`ws://${location.host}/os/agent/ui`);
    ws.onopen = () => {
      delay = 3000;
      ws!.send(JSON.stringify({ type: "register", tools: tools.map(({ execute, ...d }) => d) }));
    };
    ws.onmessage = async (e) => {
      const m = JSON.parse(String(e.data));
      if (m.type !== "call") return;
      const tool = tools.find((t) => t.name === m.tool);
      try {
        if (!tool) throw new Error("unknown tool");
        ws!.send(JSON.stringify({ type: "result", id: m.id, ok: true, result: await tool.execute(m.args ?? {}) }));
      } catch (err) {
        ws!.send(JSON.stringify({ type: "result", id: m.id, ok: false, error: (err as Error).message }));
      }
    };
    ws.onclose = () => {
      if (stopped) return;
      timer = setTimeout(connect, delay);
      delay = Math.min(delay * 2, 60_000); // back off: a refused connection (agents disabled) shouldn't hammer the host
    };
  };
  connect();
  return () => {
    stopped = true;
    clearTimeout(timer);
    ws?.close();
    unregister.forEach((off) => off());
  };
}
