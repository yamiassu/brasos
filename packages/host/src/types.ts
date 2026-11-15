import type { ServerWebSocket } from "bun";
import type { createAudit } from "@brasos/audit";

export type AuditFn = ReturnType<typeof createAudit>;

/** A Web App Manifest (the PWA standard) plus our extension block. Built-in apps and installed PWAs share this shape. */
export type Manifest = {
  name: string;
  short_name?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  icons?: { src: string; sizes?: string; type?: string }[];
  brasos?: {
    icon?: string;
    /** may ship in the hardened package (default: no) */
    hardened?: boolean;
    /**
     * server-side capabilities this app may use. Built-in apps hold what they list. For an installed PWA this is only a REQUEST:
     * the install prompt shows each one (with its `reason`) and the user grants a subset. A bare string has no reason.
     */
    permissions?: (string | { id: string; reason?: string })[];
    /** `frame: false` = no BrasOS title bar; the app draws and controls its own window (needs `window.frameless` for an installed PWA) */
    window?: { frame?: boolean };
  };
};

/** Contributed by an enable-able package (e.g. "hardened"). Every enabled policy must allow, so policies only ever restrict. */
export type Policy = {
  name: string;
  allowApp?(m: Manifest): boolean;
  allowCapability?(cap: string): boolean;
};

/** Which origin a request is addressed to (shell: localhost; app: <id>.localhost; website: <id>.web.localhost) */
export type Target = { kind: "shell" } | { kind: "app"; id: string } | { kind: "site"; id: string };

export type Gate = { ok: true; caller: Target } | { ok: false; res: Response };

export type Ctx = {
  url: URL;
  /** the origin the request was addressed to */
  target: Target;
  audit: AuditFn;
  /**
   * The capability check: caller identity from the browser-set Origin header, manifest permission, policies, audited.
   * `quiet` is for read-only capabilities: allows are throttled in the trail (with a suppressed count); denials never are.
   */
  gate(cap: string, opts?: { sameOrigin?: boolean; quiet?: boolean }): Gate;
  /** The same check for a non-browser caller the slice has already authenticated (an AI agent holding the token). Audited. */
  allow(cap: string, as: "agent", detail?: Record<string, unknown>): boolean;
  /** upgrade to a WebSocket handled by `slice`'s `ws` handlers */
  upgrade(slice: string, data?: Record<string, unknown>): boolean;
};

/** Object schema subset: enough to describe tool arguments to an agent and to validate them (see packages/agent). */
export type JsonSchema = {
  type: "object";
  properties?: Record<string, { type: "string" | "number" | "integer" | "boolean"; description?: string; enum?: string[]; minimum?: number; maximum?: number }>;
  required?: string[];
};

/**
 * Something an AI agent can do. Slices declare tools next to their routes; the agent slice exposes them over MCP.
 * A tool is only callable if the agent holds its `capability` and no enabled package forbids it.
 */
export type Tool = {
  /** letters, digits, `_` and `-` (e.g. "fs_list") */
  name: string;
  description: string;
  inputSchema: JsonSchema;
  capability: string;
  readOnly?: boolean;
  destructive?: boolean;
  run(args: any): unknown | Promise<unknown>;
};

/** A vertical slice's contribution to the server: routes, tools and/or WebSocket handlers. Return undefined to pass. */
export interface Slice {
  name: string;
  tools?: Tool[];
  handle?(req: Request, ctx: Ctx): Response | undefined | Promise<Response | undefined>;
  ws?: {
    open(ws: ServerWebSocket<any>): void;
    message(ws: ServerWebSocket<any>, raw: string | Buffer): void;
    close(ws: ServerWebSocket<any>): void;
  };
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
export const text = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
