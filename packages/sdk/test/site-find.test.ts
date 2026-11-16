import { expect, test } from "bun:test";
import { countMatches, installSiteReporter } from "../src/site";

test("counting ignores case and counts every occurrence", () => {
  expect(countMatches(["Hello hello", "HELLO"], "hello")).toBe(3);
  expect(countMatches(["aaa"], "aa")).toBe(1); // non-overlapping
  expect(countMatches(["abc"], "")).toBe(0);
});

/** a page as installSiteReporter sees it: records listeners, what it posts to its parent, and what it searched for */
function fakePage(text: string[]) {
  const listeners: Record<string, ((e: any) => void)[]> = {};
  const parent = { posted: [] as any[], postMessage(m: any) { this.posted.push(m); } };
  const searched: string[] = [];
  const w: any = {
    __BRASOS_SITE__: "https://site.test",
    location: { ancestorOrigins: ["http://browser.localhost:7000"], pathname: "/", search: "", hash: "", origin: "http://x" },
    parent,
    document: {
      readyState: "loading", title: "", querySelector: () => null, body: {},
      createTreeWalker: () => { let i = 0; return { nextNode: () => (i < text.length ? { nodeValue: text[i++], parentElement: { tagName: "P" } } : null) }; },
    },
    history: { pushState() {}, replaceState() {} },
    addEventListener: (ev: string, fn: any) => (listeners[ev] ??= []).push(fn),
    getSelection: () => ({ removeAllRanges() {} }),
    find: (q: string) => (searched.push(q), true),
  };
  installSiteReporter(w);
  const send = (data: any, source: any = parent, origin = "http://browser.localhost:7000") => listeners.message?.forEach((fn) => fn({ data, source, origin }));
  return { w, parent, searched, send };
}

test("the framing app can search the page and gets the count and position back", () => {
  const p = fakePage(["one two one", "ONE"]);
  p.send({ brasos: "find", q: "one" });
  p.send({ brasos: "find", q: "one", dir: "next" });
  p.send({ brasos: "find", q: "one", dir: "prev" });
  const found = p.parent.posted.filter((m) => m.brasos === "found");
  expect(found.map((m) => [m.count, m.idx])).toEqual([[3, 1], [3, 2], [3, 1]]);
});

test("a search from anyone else is ignored", () => {
  const p = fakePage(["one"]);
  p.send({ brasos: "find", q: "one" }, {}, "http://browser.localhost:7000"); // not the parent window
  p.send({ brasos: "find", q: "one" }, p.parent, "http://evil.test"); // not the framing origin
  expect(p.searched).toEqual([]);
  expect(p.parent.posted.filter((m) => m.brasos === "found")).toEqual([]);
});

test("no match reports found: false", () => {
  const p = fakePage(["nothing here"]);
  p.send({ brasos: "find", q: "zebra" });
  expect(p.parent.posted.filter((m) => m.brasos === "found")[0]).toMatchObject({ found: false, count: 0, idx: 0 });
});
