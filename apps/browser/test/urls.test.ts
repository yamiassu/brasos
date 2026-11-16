import { expect, test } from "bun:test";
import { groupByDay, hostOf, idFor, isSecure, suggest, toTarget, type Mark } from "../urls";

test("a typed line is an address, a search, or refused", () => {
  expect(toTarget("")).toBeNull();
  expect(toTarget("example.com")).toEqual({ kind: "url", url: "https://example.com/" });
  expect(toTarget("localhost:3000/app")).toEqual({ kind: "url", url: "http://localhost:3000/app" });
  expect(toTarget("http://a.test/x?y=1")).toEqual({ kind: "url", url: "http://a.test/x?y=1" });
  expect(toTarget("how to bake bread")).toEqual({ kind: "search", url: "https://duckduckgo.com/?q=how%20to%20bake%20bread" });
  expect(toTarget("cats", "wikipedia")?.url).toStartWith("https://en.wikipedia.org/");
  expect(toTarget("javascript:alert(1)")).toEqual({ kind: "blocked", url: "" });
  expect(toTarget("file:///etc/passwd")).toEqual({ kind: "blocked", url: "" });
  expect(toTarget("ftp://x.test")).toEqual({ kind: "blocked", url: "" });
});

test("hosts and security", () => {
  expect(hostOf("https://www.example.com/a")).toBe("example.com");
  expect(hostOf("nonsense")).toBe("");
  expect(isSecure("https://a.test")).toBe(true);
  expect(isSecure("http://a.test")).toBe(false);
});

const m = (url: string, title: string, at = 0): Mark => ({ id: idFor(url), url, title, at });

test("suggestions put favorites first and list each address once", () => {
  const fav = [m("https://news.test/", "The News")];
  const hist = [m("https://news.test/", "The News"), m("https://newsletter.test/", "Weekly"), m("https://other.test/", "Other")];
  expect(suggest("new", fav, hist).map((s) => [s.url, s.kind])).toEqual([["https://news.test/", "favorite"], ["https://newsletter.test/", "history"]]);
  expect(suggest("", fav, hist)).toEqual([]);
  expect(suggest("zzz", fav, hist)).toEqual([]);
  expect(suggest("e", fav, hist, 2)).toHaveLength(2);
});

test("history is grouped by day, newest first", () => {
  const now = new Date("2026-11-16T15:00:00");
  const h = [m("https://a.test", "a", +new Date("2026-11-16T09:00:00")), m("https://b.test", "b", +new Date("2026-11-15T20:00:00")), m("https://c.test", "c", +new Date("2026-11-16T14:00:00"))];
  const g = groupByDay(h, now);
  expect(g.map((x) => x.label).slice(0, 2)).toEqual(["Today", "Yesterday"]);
  expect(g[0].items.map((x) => x.title)).toEqual(["c", "a"]);
});

test("an address always gets the same id", () => {
  expect(idFor("https://a.test/")).toBe(idFor("https://a.test/"));
  expect(idFor("https://a.test/")).not.toBe(idFor("https://b.test/"));
});
