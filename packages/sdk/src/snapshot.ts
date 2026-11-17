// A small picture of the window's own page, for the shell's window switcher (Alt+Tab). The shell can't read another origin's pixels, so
// each window draws itself: the page is copied with its computed styles written inline, wrapped in an SVG `foreignObject`, drawn on a
// canvas and sent to the shell as a JPEG (the shell asks with { brasos: "snapshot-request" }, see heartbeat.ts).
// What it can't show: <canvas> content that is tainted, video, frames inside the page, images from other origins, CSS background images
// and web fonts (an SVG drawn as an image loads nothing from the network), and scrolled-away content (a scroller shows from its top).
// A picture that doesn't come out is simply not sent, and the switcher shows the app's icon instead.

/** the widest a picture is (the card in the switcher is smaller still) */
export const THUMB_W = 320;
export const MAX_NODES = 3500; // a page with more is not drawn: copying every style would take too long

/** the page's size, from the shell's request when the window is hidden (a minimized window reports 0 x 0); null for sizes that make no sense */
export function requestedSize(m: { w?: unknown; h?: unknown }, own: { w: number; h: number }): { w: number; h: number } | null {
  const ok = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 8000;
  const w = own.w > 0 ? own.w : m.w;
  const h = own.h > 0 ? own.h : m.h;
  return ok(w) && ok(h) ? { w, h } : null;
}

/** the picture's size: at most THUMB_W wide, the page's shape */
export function thumbSize(w: number, h: number, maxW = THUMB_W): { w: number; h: number } {
  const tw = Math.min(maxW, w);
  return { w: tw, h: Math.max(1, Math.round((h * tw) / w)) };
}

const SKIP = new Set(["SCRIPT", "NOSCRIPT", "STYLE", "LINK", "META", "TEMPLATE", "TITLE", "HEAD"]);

/** a data URL for an <img> or <canvas> that is already on the page, or "" when the browser won't give its pixels (a tainted source) */
function pixels(el: HTMLImageElement | HTMLCanvasElement): string {
  try {
    const c = document.createElement("canvas");
    const w = el instanceof HTMLImageElement ? el.naturalWidth : el.width;
    const h = el instanceof HTMLImageElement ? el.naturalHeight : el.height;
    if (!w || !h || w * h > 4_000_000) return "";
    c.width = w;
    c.height = h;
    c.getContext("2d")!.drawImage(el, 0, 0);
    return c.toDataURL("image/png");
  } catch {
    return "";
  }
}

/** copy `src` into a clone with every element's computed style written inline (so no stylesheet is needed), or null when the page is too big */
function inlined(src: Element, win: Window, budget: { n: number }): Element | null {
  if (++budget.n > MAX_NODES) return null;
  let dst: Element;
  if (src instanceof HTMLCanvasElement || src instanceof HTMLImageElement) {
    dst = document.createElement("img");
    const u = pixels(src);
    if (u) (dst as HTMLImageElement).src = u;
  } else if (src instanceof HTMLVideoElement || src instanceof HTMLIFrameElement) {
    dst = document.createElement("div"); // can't be drawn: an empty box of the same size
  } else {
    dst = src.cloneNode(false) as Element;
    if (src instanceof HTMLInputElement || src instanceof HTMLTextAreaElement) {
      dst.setAttribute("value", src.value);
      if (src instanceof HTMLTextAreaElement) dst.textContent = src.value;
      if (src instanceof HTMLInputElement) src.checked ? dst.setAttribute("checked", "") : dst.removeAttribute("checked");
    }
  }
  const cs = win.getComputedStyle(src);
  const style = (dst as HTMLElement).style;
  if (style) for (let i = 0; i < cs.length; i++) style.setProperty(cs[i], cs.getPropertyValue(cs[i]), cs.getPropertyPriority(cs[i]));
  if (!(src instanceof HTMLCanvasElement || src instanceof HTMLImageElement || src instanceof HTMLVideoElement || src instanceof HTMLIFrameElement)) {
    for (const child of src.childNodes) {
      if (child.nodeType === 3) dst.appendChild(child.cloneNode());
      else if (child.nodeType === 1 && !SKIP.has((child as Element).tagName)) {
        const c = inlined(child as Element, win, budget);
        if (!c) return null;
        dst.appendChild(c);
      }
    }
  }
  return dst;
}

/** Draws the page at `size` (the window's size) and returns a JPEG data URL at thumbnail size, or null when it didn't work. Never throws. */
export async function capture(size: { w: number; h: number }, win: Window = window): Promise<{ w: number; h: number; url: string } | null> {
  try {
    const doc = win.document;
    const body = doc.body;
    if (!body) return null;
    const box = inlined(body, win, { n: 0 }) as HTMLElement | null;
    if (!box) return null;
    const bg = [win.getComputedStyle(body).backgroundColor, win.getComputedStyle(doc.documentElement).backgroundColor].find((c) => c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") ?? "rgb(18, 18, 18)";
    // the body keeps its own margins and size; the wrapper gives the page's viewport
    const wrap = document.createElement("div");
    wrap.style.cssText = `width:${size.w}px;height:${size.h}px;overflow:hidden;position:relative;background:${bg}`;
    box.style.width = `${size.w}px`;
    box.style.minHeight = `${size.h}px`;
    wrap.appendChild(box);
    const xml = new XMLSerializer().serializeToString(wrap); // well-formed XML, as an SVG image needs
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.w}" height="${size.h}"><foreignObject width="100%" height="100%">${xml}</foreignObject></svg>`;
    const img = new Image();
    const loaded = new Promise<boolean>((ok) => {
      img.onload = () => ok(true);
      img.onerror = () => ok(false);
      setTimeout(() => ok(false), 2500);
    });
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    if (!(await loaded)) return null;
    const t = thumbSize(size.w, size.h);
    const canvas = doc.createElement("canvas");
    canvas.width = t.w;
    canvas.height = t.h;
    const g = canvas.getContext("2d")!;
    g.fillStyle = bg;
    g.fillRect(0, 0, t.w, t.h);
    g.drawImage(img, 0, 0, t.w, t.h);
    const url = canvas.toDataURL("image/jpeg", 0.72);
    return url.length <= 150_000 ? { ...t, url } : null;
  } catch {
    return null;
  }
}
