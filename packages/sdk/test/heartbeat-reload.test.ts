import { expect, test } from "bun:test";

import { isDevtoolsKey, isReloadKey, nativeMenu } from "../src/heartbeat";

test("the reload keys are recognised, ordinary keys are not", () => {
  expect(isReloadKey({ key: "F5" })).toBe(true);
  expect(isReloadKey({ key: "r", ctrlKey: true })).toBe(true);
  expect(isReloadKey({ key: "R", ctrlKey: true })).toBe(true); // Ctrl+Shift+R
  expect(isReloadKey({ key: "r", metaKey: true })).toBe(true);
  expect(isReloadKey({ key: "r" })).toBe(false);
  expect(isReloadKey({ key: "F4" })).toBe(false);
  expect(isReloadKey({ key: "k", ctrlKey: true })).toBe(false);
});

test("the devtools keys are recognised, ordinary keys are not", () => {
  expect(isDevtoolsKey({ key: "F12" })).toBe(true);
  expect(isDevtoolsKey({ key: "I", ctrlKey: true, shiftKey: true })).toBe(true);
  expect(isDevtoolsKey({ key: "j", ctrlKey: true, shiftKey: true })).toBe(true);
  expect(isDevtoolsKey({ key: "c", metaKey: true, shiftKey: true })).toBe(true);
  expect(isDevtoolsKey({ key: "i", ctrlKey: true })).toBe(false); // Ctrl+I alone is italic
  expect(isDevtoolsKey({ key: "i" })).toBe(false);
  expect(isDevtoolsKey({ key: "F11" })).toBe(false);
});

test("the browser's context menu is suppressed except in text fields", () => {
  expect(nativeMenu({ target: { tagName: "DIV" } })).toBe(true);
  expect(nativeMenu({ target: { tagName: "INPUT" } })).toBe(false);
  expect(nativeMenu({ target: { tagName: "TEXTAREA" } })).toBe(false);
  expect(nativeMenu({ target: { tagName: "DIV", isContentEditable: true } })).toBe(false);
});
