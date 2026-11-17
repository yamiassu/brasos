// The extension's worker: when a page reports that its site was installed as an app (or the toolbar button is pressed), it asks BrasOS to add
// the app. BrasOS shows its own install prompt (what the app may do, and where it runs): this only asks, it installs nothing.
// The address of BrasOS comes from config.js, which the image writes next to this file.
import "./config.js";
import { installRequest } from "./core.js";

const badge = (tabId, text, color) => {
  chrome.action.setBadgeBackgroundColor({ color, tabId });
  chrome.action.setBadgeText({ text, tabId });
};

async function ask(m, tabId) {
  const body = installRequest(m);
  if (!body) return badge(tabId, "!", "#c0392b"); // no manifest on this page: nothing to add
  try {
    const r = await fetch(`${globalThis.BRASOS_HOST}/os/apps/requests`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    badge(tabId, r.ok ? "✓" : "!", r.ok ? "#27ae60" : "#c0392b");
  } catch {
    badge(tabId, "!", "#c0392b"); // BrasOS isn't answering
  }
}

chrome.runtime.onMessage.addListener((m, sender) => {
  if (m && m.kind === "installed" && sender.tab) void ask(m, sender.tab.id);
});

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await ask(await chrome.tabs.sendMessage(tab.id, { kind: "get" }), tab.id);
  } catch {
    badge(tab.id, "!", "#c0392b"); // a page the extension can't run in (a browser page)
  }
});
