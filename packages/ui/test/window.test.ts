import { expect, test } from "bun:test";
import { createWindowDrag, type WindowControls } from "../src/window";

const fake = () => {
  const calls: unknown[][] = [];
  const w: WindowControls = {
    close: () => calls.push(["close"]), minimize: () => calls.push(["minimize"]), toggleMaximize: () => calls.push(["max"]),
    moveBy: (dx, dy, at) => calls.push(["moveBy", dx, dy, at]), moveEnd: () => calls.push(["end"]), focus: () => calls.push(["focus"]),
  };
  return { w, calls };
};
const bar = { classList: { contains: () => false }, setPointerCapture() {}, hasPointerCapture: () => false, releasePointerCapture() {} };
const ptr = (o: Partial<{ target: any; clientX: number; clientY: number; movementX: number; movementY: number; button: number }> = {}) =>
  ({ target: bar, currentTarget: bar, clientX: 0, clientY: 0, movementX: 0, movementY: 0, button: 0, pointerId: 1, ...o });

test("a drag on the bar moves the window, reports the pointer, and ends with moveEnd", () => {
  const { w, calls } = fake();
  const d = createWindowDrag(w);
  d.onPointerDown(ptr({ clientX: 100, clientY: 20 }));
  d.onPointerMove(ptr({ clientX: 150, clientY: 40, movementX: 50, movementY: 20 }));
  d.onPointerMove(ptr({ clientX: 160, clientY: 1, movementX: 10, movementY: -39 }));
  d.onPointerUp(ptr({ clientX: 160, clientY: 1 }));
  expect(calls).toEqual([["focus"], ["moveBy", 50, 20, { x: 150, y: 40 }], ["moveBy", 10, -39, { x: 160, y: 1 }], ["end"]]);
});

test("a click or the first half of a double click is not a drag, and sends no moveEnd", () => {
  const { w, calls } = fake();
  const d = createWindowDrag(w);
  d.onPointerDown(ptr({ clientX: 100, clientY: 20 }));
  d.onPointerMove(ptr({ clientX: 102, clientY: 21, movementX: 2, movementY: 1 }));
  d.onPointerUp(ptr());
  expect(calls).toEqual([["focus"]]);
});

test("only the bar itself, or an element marked ui-drag, starts a drag; a button inside the bar does not", () => {
  const { w, calls } = fake();
  const d = createWindowDrag(w);
  const button = { classList: { contains: () => false } };
  d.onPointerDown(ptr({ target: button, clientX: 5 }));
  d.onPointerMove(ptr({ clientX: 100, movementX: 95 }));
  expect(calls.filter((c) => c[0] === "moveBy")).toEqual([]);
  const spacer = { classList: { contains: (c: string) => c === "ui-drag" } };
  d.onPointerDown(ptr({ target: spacer }));
  d.onPointerMove(ptr({ clientX: 50, movementX: 50 }));
  expect(calls.filter((c) => c[0] === "moveBy")).toHaveLength(1);
  d.onPointerDown(ptr({ button: 2 })); // not the main button
});

test("a double click on the bar toggles maximize, on a button it does not", () => {
  const { w, calls } = fake();
  const d = createWindowDrag(w);
  d.onDoubleClick({ target: bar, currentTarget: bar });
  d.onDoubleClick({ target: { classList: { contains: () => false } }, currentTarget: bar });
  expect(calls).toEqual([["max"]]);
});

test("cancelling a drag still ends it, so the shell drops its preview", () => {
  const { w, calls } = fake();
  const d = createWindowDrag(w);
  d.onPointerDown(ptr());
  d.onPointerMove(ptr({ clientX: 30, movementX: 30 }));
  d.onPointerCancel(ptr());
  expect(calls.map((c) => c[0])).toEqual(["focus", "moveBy", "end"]);
});
