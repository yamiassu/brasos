import { expect, test } from "bun:test";
import { accountProblem } from "../src/setup";

const ok = { display: "Maria", username: "maria", password: "correct horse 42" };

test("the installer checks the account before asking the server", () => {
  expect(accountProblem(ok, ok.password)).toBe("");
  expect(accountProblem({ ...ok, display: " " }, ok.password)).toMatch(/name/);
  expect(accountProblem({ ...ok, username: "Maria S" }, ok.password)).toMatch(/username/);
  expect(accountProblem({ ...ok, password: "short" }, "short")).toMatch(/10/);
  expect(accountProblem({ ...ok, password: "maria-maria-2026" }, "maria-maria-2026")).toMatch(/easy/);
  expect(accountProblem(ok, "different")).toMatch(/match/);
});
