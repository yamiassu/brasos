import { expect, test } from "bun:test";
import { installHeartbeat, isSwitchKey } from "../src/heartbeat";

// A window's keys never reach the shell around it, so every window forwards Alt+Tab. A fake window collects its listeners by event type.
function fake(hostname = "about.localhost") {
  const on: Record<string, ((e: any) => void)[]> = {};
  const sent: any[] = [];
  const parent = { postMessage: (m: any, to: string) => sent.push([m, to]) };
  installHeartbeat({ addEventListener: (t: string, f: any) => (on[t] ??= []).push(f), parent, location: { hostname, protocol: "http:", port: "7000" } });
  const fire = (t: string, e: any) => on[t]?.forEach((f) => f({ preventDefault() {}, ...e }));
  return { sent, fire };
}

test("Alt+Tab, Shift+Alt+Tab, releasing Alt and Escape are forwarded to the shell, and only to the shell's origin", () => {
  const w = fake();
  w.fire("keydown", { key: "Tab", altKey: true });
  w.fire("keydown", { key: "Tab", altKey: true, shiftKey: true });
  w.fire("keyup", { key: "Alt" });
  expect(w.sent).toEqual([
    [{ brasos: "switch", phase: "next", shift: false }, "http://localhost:7000"],
    [{ brasos: "switch", phase: "next", shift: true }, "http://localhost:7000"],
    [{ brasos: "switch", phase: "end", shift: false }, "http://localhost:7000"],
  ]);
  w.sent.length = 0;
  w.fire("keydown", { key: "Tab", altKey: true });
  w.fire("keydown", { key: "Escape" });
  expect(w.sent.map(([m]) => m.phase)).toEqual(["next", "cancel"]);
});

test("nothing is forwarded unless a switch is under way, and other Tab keys are left alone", () => {
  const w = fake();
  w.fire("keydown", { key: "Tab" }); // plain Tab: the app's own
  w.fire("keydown", { key: "Tab", altKey: true, ctrlKey: true });
  w.fire("keydown", { key: "Escape" }); // not switching: the app's own
  w.fire("keyup", { key: "Alt" });
  w.fire("pointerdown", {});
  expect(w.sent).toEqual([]);
  w.fire("keydown", { key: "Tab", altKey: true });
  w.fire("pointerdown", {}); // a click while the switcher is open dismisses it
  expect(w.sent.map(([m]) => m.phase)).toEqual(["next", "cancel"]);
  expect(isSwitchKey({ key: "Tab", altKey: true })).toBe(true);
});

test("a website loaded through the gateway forwards it too", () => {
  const w = fake("abcdef.web.localhost");
  w.fire("keydown", { key: "Tab", altKey: true });
  expect(w.sent.length).toBe(1);
});
