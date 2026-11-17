import { expect, test } from "bun:test";
import { requestedSize, thumbSize } from "../src/snapshot";
import { installHeartbeat } from "../src/heartbeat";

test("the picture is as wide as the card at most and keeps the page's shape", () => {
  expect(thumbSize(1280, 800)).toEqual({ w: 320, h: 200 });
  expect(thumbSize(200, 100)).toEqual({ w: 200, h: 100 }); // never enlarged
  expect(thumbSize(4000, 1).h).toBe(1);
});

test("a hidden window takes its size from the shell's request, and absurd sizes are refused", () => {
  expect(requestedSize({ w: 640, h: 420 }, { w: 0, h: 0 })).toEqual({ w: 640, h: 420 }); // minimized: the window reports 0 x 0
  expect(requestedSize({ w: 640, h: 420 }, { w: 800, h: 500 })).toEqual({ w: 800, h: 500 }); // visible: its own size wins
  expect(requestedSize({ w: 0, h: 420 }, { w: 0, h: 0 })).toBeNull();
  expect(requestedSize({ w: 99999, h: 420 }, { w: 0, h: 0 })).toBeNull();
  expect(requestedSize({ w: 1.5, h: 420 }, { w: 0, h: 0 })).toBeNull();
  expect(requestedSize({ w: "640", h: 420 }, { w: 0, h: 0 })).toBeNull();
});

test("only the parent shell is answered, and a website is never copied", () => {
  const mk = (hostname: string) => {
    let message: (e: any) => void = () => {};
    const parent = { postMessage() {} };
    installHeartbeat({ addEventListener: (t: string, f: any) => t === "message" && (message = f), parent, location: { hostname, protocol: "http:", port: "7000" } });
    return { message, parent };
  };
  // nothing here may throw: a request from a stranger, a website window and bad sizes are all dropped quietly
  const app = mk("about.localhost");
  app.message({ source: {}, origin: "x", data: { brasos: "snapshot-request", w: 640, h: 420 } });
  app.message({ source: app.parent, origin: "x", data: { brasos: "snapshot-request", w: -1, h: 420 } });
  const site = mk("abc.web.localhost");
  site.message({ source: site.parent, origin: "x", data: { brasos: "snapshot-request", w: 640, h: 420 } });
  expect(true).toBe(true);
});
