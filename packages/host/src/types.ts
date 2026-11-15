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
    /** server-side capabilities this app may use */
    permissions?: string[];
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
  /** the capability check: caller identity from the browser-set Origin header, manifest permission, policies, audited */
  gate(cap: string, opts?: { sameOrigin?: boolean }): Gate;
  /** upgrade to a WebSocket handled by `slice`'s `ws` handlers */
  upgrade(slice: string, data?: Record<string, unknown>): boolean;
};

/** A vertical slice's contribution to the server: routes and/or WebSocket handlers. Return undefined to pass. */
export interface Slice {
  name: string;
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
