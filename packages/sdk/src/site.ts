// Runs inside a website loaded through the gateway: tells the framing browser app where it really is
// (the page's own URL is a gateway URL) and whether it is an installable PWA.
export function installSiteReporter(w: any) {
  const site: string | undefined = w.__BRASOS_SITE__; // real origin, injected by the gateway
  const to: string | undefined = w.location?.ancestorOrigins?.[0]; // only report to whoever frames us
  if (!site || !to || w.parent === w) return;

  const report = () => {
    const link = w.document.querySelector('link[rel~="manifest"]') as HTMLLinkElement | null;
    w.parent.postMessage(
      {
        brasos: "navigated",
        url: site + w.location.pathname + w.location.search + w.location.hash,
        title: w.document.title,
        // the manifest link resolves to a gateway URL; map it back to the real one
        manifest: link ? link.href.replace(w.location.origin, site) : null,
      },
      to,
    );
  };
  for (const m of ["pushState", "replaceState"] as const) {
    const orig = w.history[m].bind(w.history);
    w.history[m] = (...a: unknown[]) => (orig(...a), queueMicrotask(report));
  }
  for (const ev of ["DOMContentLoaded", "load", "popstate", "hashchange"]) w.addEventListener(ev, report);
  if (w.document.readyState !== "loading") report();

  // The framing app can search this page (Ctrl+F in Religare). Only messages from the frame's parent, at the origin that
  // framed us, are heard; the page itself never sees the search. Matches that span several elements are not counted.
  let q = "", count = 0, idx = 0;
  w.addEventListener("message", (e: any) => {
    const m = e.data;
    if (e.source !== w.parent || e.origin !== to || m?.brasos !== "find") return;
    const sel = w.getSelection?.();
    if (!m.q) return void (sel?.removeAllRanges(), (q = ""));
    const fresh = m.q !== q || !!m.restart;
    if (fresh) {
      q = String(m.q);
      count = countMatches(pageText(w.document), q);
      idx = 0;
      sel?.removeAllRanges();
    }
    const back = m.dir === "prev";
    const found = count > 0 && !!w.find?.(q, false, back, true, false, false, false);
    if (found) idx = fresh ? 1 : back ? ((idx - 2 + count) % count) + 1 : (idx % count) + 1;
    w.parent.postMessage({ brasos: "found", q, found, count, idx: found ? idx : 0 }, to);
  });
}

/** how often `needle` occurs in the texts, ignoring case */
export function countMatches(texts: string[], needle: string): number {
  const low = needle.toLowerCase();
  if (!low) return 0;
  let n = 0;
  for (const t of texts) for (let i = t.toLowerCase().indexOf(low); i >= 0; i = t.toLowerCase().indexOf(low, i + low.length)) n++;
  return n;
}

/** the visible-ish text of a page: text nodes outside scripts and styles */
function pageText(doc: any): string[] {
  const out: string[] = [];
  const walker = doc.createTreeWalker(doc.body, 4 /* SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (/^(SCRIPT|STYLE|NOSCRIPT)$/.test(node.parentElement?.tagName ?? "")) continue;
    out.push(node.nodeValue ?? "");
  }
  return out;
}
