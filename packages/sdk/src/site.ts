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
}
