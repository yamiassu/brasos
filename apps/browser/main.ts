// A small browser. It never loads a site directly: every address goes through the OS web gateway (os.web.open), which
// gives the site its own origin, serves TypeScript as JavaScript and makes PWAs work. Sites report where they really are
// (the iframe URL is a gateway URL) via the SDK that the gateway injects.
import { os } from "@brasos/sdk";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const frame = $<HTMLIFrameElement>("frame");
const urlBox = $<HTMLInputElement>("url");
const [back, forward, reload, install] = ["back", "forward", "reload", "install"].map((id) => $<HTMLButtonElement>(id));
const say = (s: string) => ($("status").textContent = s);

let stack: string[] = []; // real URLs, not gateway URLs
let at = -1;
let manifest: string | null = null;

const normalize = (raw: string) => new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw.trim()) ? raw.trim() : "https://" + raw.trim()).href;

function sync() {
  back.disabled = at <= 0;
  forward.disabled = at >= stack.length - 1;
  install.disabled = !manifest;
  urlBox.value = stack[at] ?? "";
}

async function load(target: string) {
  say("Loading…");
  try {
    frame.src = (await os.web.open(target)).url;
  } catch (e) {
    say((e as Error).message);
  }
}

async function go(raw: string) {
  let target: string;
  try {
    target = normalize(raw);
  } catch {
    return say("That isn't a valid address");
  }
  stack = [...stack.slice(0, at + 1), target];
  at = stack.length - 1;
  manifest = null;
  sync();
  await load(target);
}

$("bar").addEventListener("submit", (e) => (e.preventDefault(), go(urlBox.value)));
back.onclick = () => at > 0 && (at--, manifest = null, sync(), load(stack[at]));
forward.onclick = () => at < stack.length - 1 && (at++, manifest = null, sync(), load(stack[at]));
reload.onclick = () => at >= 0 && load(stack[at]);
install.onclick = async () => {
  if (!manifest) return;
  try {
    say(`Installed ${(await os.apps.install(manifest)).name}`);
  } catch (e) {
    say((e as Error).message);
  }
};

// The page inside the frame tells us where it really is (see packages/sdk/src/site.ts).
addEventListener("message", (e: MessageEvent) => {
  if (e.source !== frame.contentWindow || e.data?.brasos !== "navigated") return;
  const { url, title, manifest: m } = e.data as { url: string; title: string; manifest: string | null };
  if (url !== stack[at]) {
    stack = [...stack.slice(0, at + 1), url]; // the user followed a link
    at = stack.length - 1;
  }
  manifest = m;
  say(title || "");
  sync();
});

sync();
