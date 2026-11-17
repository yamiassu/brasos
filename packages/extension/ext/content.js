// Runs in every page. It does nothing until the browser says the site was installed as an app (`appinstalled`), or the toolbar button
// asks for the page's details. It sends the address of the site's manifest to the extension's worker and nothing else.
(() => {
  const info = () => {
    const l = document.querySelector('link[rel~="manifest" i]');
    return { manifestUrl: l ? l.href : "", pageUrl: location.href };
  };
  addEventListener("appinstalled", () => {
    const i = info();
    if (i.manifestUrl) chrome.runtime.sendMessage({ kind: "installed", ...i });
  });
  chrome.runtime.onMessage.addListener((m, _sender, reply) => {
    if (m && m.kind === "get") reply(info());
  });
})();
