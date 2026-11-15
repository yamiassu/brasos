import { expect, test } from "bun:test";
import { createAudit } from "../src/audit";
import { verifyAudit } from "../src/verify";

const trail = (n: number) => {
  const lines: string[] = [];
  const audit = createAudit([(l) => lines.push(l)]);
  for (let i = 0; i < n; i++) audit("test.event", i % 2 ? "deny" : "allow", { app: "x" }, { i });
  return lines;
};

test("an intact chain verifies", () => {
  expect(verifyAudit(trail(5).join("\n"))).toMatchObject({ ok: true, events: 5, instances: 1 });
});

test("an altered record is detected", () => {
  const lines = trail(5);
  lines[1] = lines[1].replace('"outcome":"', '"outcome":"x');
  expect(verifyAudit(lines.join("\n")).ok).toBe(false);
});

test("a deleted record is detected", () => {
  const lines = trail(5);
  lines.splice(2, 1);
  expect(verifyAudit(lines.join("\n")).ok).toBe(false);
});

test("reordered records are detected", () => {
  const [a, b, ...rest] = trail(5);
  expect(verifyAudit([b, a, ...rest].join("\n")).ok).toBe(false);
});

test("a record truncated from the head is detected", () => {
  expect(verifyAudit(trail(5).slice(1).join("\n")).ok).toBe(false);
});

test("two process lifetimes are two independent chains", () => {
  expect(verifyAudit([...trail(3), ...trail(2)].join("\n"))).toMatchObject({ ok: true, instances: 2 });
});

test("throttling counts what it drops and reports it on the next recorded event", async () => {
  const lines: string[] = [];
  const audit = createAudit([(l) => lines.push(l)]);
  const limit = { key: "k", ms: 30 };
  audit("flood", "deny", {}, {}, limit);
  audit("flood", "deny", {}, {}, limit);
  audit("flood", "deny", {}, {}, limit);
  expect(lines.length).toBe(1);
  await Bun.sleep(40);
  audit("flood", "deny", {}, {}, limit);
  expect(JSON.parse(lines[1].slice(6)).detail.suppressed).toBe(2);
});

test("a failing sink makes the caller fail (privileged actions fail closed)", () => {
  const audit = createAudit([() => { throw new Error("disk full"); }]);
  expect(() => audit("x", "allow", {})).toThrow("disk full");
});
