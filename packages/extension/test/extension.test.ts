import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXTENSION_ID, extensionOrigin } from "../src";
import { installRequest } from "../ext/core.js";

const dir = join(import.meta.dir, "../ext");
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));

test("the id the host recognises is the one the manifest's key gives", () => {
  const der = Buffer.from(manifest.key, "base64");
  const id = [...createHash("sha256").update(der).digest().subarray(0, 16)].map((b) => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15))).join("");
  expect(id).toBe(EXTENSION_ID);
  expect(extensionOrigin).toBe(`chrome-extension://${EXTENSION_ID}`);
});

test("the extension asks for very little: BrasOS on this machine, and pages only to read their manifest link", () => {
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.permissions ?? []).toEqual([]); // no tabs, cookies, history, storage, downloads...
  expect(manifest.host_permissions).toEqual(["http://localhost/*"]);
  expect(manifest.content_scripts).toHaveLength(1);
  expect(manifest.content_scripts[0].js).toEqual(["content.js"]);
  expect(manifest.content_scripts[0].all_frames).toBeUndefined(); // the top page only
  expect(manifest.web_accessible_resources).toBeUndefined();
  expect(manifest.externally_connectable).toBeUndefined(); // no web page can message it
});

test("only a plain http(s) address of a sane size is passed on", () => {
  expect(installRequest({ manifestUrl: "https://notes.example.com/app.webmanifest?v=2" })).toEqual({ manifestUrl: "https://notes.example.com/app.webmanifest?v=2" });
  for (const bad of ["", "javascript:alert(1)", "file:///etc/passwd", "ftp://x/y", "https://a b", "https://a\"b", "https://a\\b", "https://" + "x".repeat(2100)]) expect(installRequest({ manifestUrl: bad })).toBeNull();
  expect(installRequest({ manifestUrl: 5 })).toBeNull();
  expect(installRequest(null)).toBeNull();
  expect(Object.keys(installRequest({ manifestUrl: "https://a.example/m", cookies: "x", pageUrl: "https://a.example/" })!)).toEqual(["manifestUrl"]); // nothing else goes out
});

test("the content script says nothing until the site is installed, then sends only the manifest address", () => {
  const sent: any[] = [];
  const handlers: Record<string, (e?: any) => void> = {};
  let listener: (m: any, s: any, reply: (r: any) => void) => void = () => {};
  const link = { href: "https://notes.example.com/m.webmanifest" };
  new Function("document", "location", "addEventListener", "chrome", readFileSync(join(dir, "content.js"), "utf8"))(
    { querySelector: () => link },
    { href: "https://notes.example.com/" },
    (t: string, f: () => void) => (handlers[t] = f),
    { runtime: { sendMessage: (m: any) => sent.push(m), onMessage: { addListener: (f: any) => (listener = f) } } },
  );
  expect(sent).toEqual([]); // loading a page tells nobody anything
  handlers.appinstalled();
  expect(sent).toEqual([{ kind: "installed", manifestUrl: link.href, pageUrl: "https://notes.example.com/" }]);
  let answer: any;
  listener({ kind: "get" }, {}, (r) => (answer = r));
  expect(answer).toEqual({ manifestUrl: link.href, pageUrl: "https://notes.example.com/" });
  listener({ kind: "other" }, {}, () => (answer = "wrong")); // anything else is ignored
  expect(answer).toEqual({ manifestUrl: link.href, pageUrl: "https://notes.example.com/" });
});

test("the worker posts the request to BrasOS and nothing else, and shows the result on the button", async () => {
  const realFetch = globalThis.fetch; // faked for this test only: every other test in the run uses the real one
  const fetched: any[] = [];
  const badges: string[] = [];
  let onMessage: (m: any, s: any) => void = () => {};
  (globalThis as any).fetch = async (url: string, init: any) => (fetched.push([url, init]), { ok: !String(url).includes("fail") });
  (globalThis as any).chrome = {
    runtime: { onMessage: { addListener: (f: any) => (onMessage = f) } },
    action: { onClicked: { addListener() {} }, setBadgeText: ({ text }: any) => badges.push(text), setBadgeBackgroundColor() {} },
    tabs: { sendMessage: async () => ({}) },
  };
  await import("../ext/background.js");
  onMessage({ kind: "installed", manifestUrl: "https://notes.example.com/m", pageUrl: "https://notes.example.com/" }, { tab: { id: 3 } });
  await Bun.sleep(20);
  expect(fetched).toHaveLength(1);
  expect(fetched[0][0]).toBe("http://localhost:7000/os/apps/requests");
  expect(fetched[0][1].method).toBe("POST");
  expect(JSON.parse(fetched[0][1].body)).toEqual({ manifestUrl: "https://notes.example.com/m" });
  expect(badges).toEqual(["✓"]);
  onMessage({ kind: "installed", manifestUrl: "javascript:alert(1)" }, { tab: { id: 3 } }); // never sent
  onMessage({ kind: "installed", manifestUrl: "https://notes.example.com/m" }, {}); // not from a tab: ignored
  onMessage({ kind: "something-else" }, { tab: { id: 3 } });
  await Bun.sleep(20);
  expect(fetched).toHaveLength(1);
  expect(badges).toEqual(["✓", "!"]);
  globalThis.fetch = realFetch;
  delete (globalThis as any).chrome;
});
