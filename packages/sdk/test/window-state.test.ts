import { expect, test } from "bun:test";
import { installHeartbeat, windowState } from "../src/heartbeat";

test("the shell's window-state message updates the maximized state, and only from the parent", () => {
  let handler: (e: any) => void = () => {};
  const parent = { postMessage() {} };
  installHeartbeat({ addEventListener: (_: string, f: any) => (handler = f), parent });
  const seen: boolean[] = [];
  windowState.subs.add((m) => seen.push(m));
  handler({ source: parent, origin: "x", data: { brasos: "window-state", max: true } });
  handler({ source: {}, origin: "x", data: { brasos: "window-state", max: false } }); // not the parent: ignored
  handler({ source: parent, origin: "x", data: { brasos: "window-state", max: "yes" } }); // not a boolean: ignored
  expect(seen).toEqual([true]);
  expect(windowState.max).toBe(true);
});
