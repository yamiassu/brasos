import { expect, test } from "bun:test";
import { dayOfYear, isoWeek, monthGrid, sameDay, todayIn, zoneInfo } from "../src/calendar";

test("a month grid has six weeks that start on the chosen weekday and show the neighbouring days", () => {
  // November 2026 starts on a Sunday
  const sun = monthGrid(2026, 10, 7);
  expect(sun.length).toBe(6);
  expect(sun.every((r) => r.length === 7)).toBe(true);
  expect(sun[0][0]).toEqual({ y: 2026, m: 10, d: 1, inMonth: true });
  const mon = monthGrid(2026, 10, 1); // weeks starting Monday: the 1st is the last cell of the first row
  expect(mon[0][6]).toEqual({ y: 2026, m: 10, d: 1, inMonth: true });
  expect(mon[0][0]).toEqual({ y: 2026, m: 9, d: 26, inMonth: false });
  expect(mon.flat().filter((c) => c.inMonth).length).toBe(30);
  expect(monthGrid(2026, 11, 7).flat().some((c) => c.y === 2027 && c.m === 0 && c.d === 1)).toBe(true); // December shows January's first days
});

test("week number, day of the year and the same-day check", () => {
  expect(isoWeek({ y: 2026, m: 0, d: 1 })).toBe(1);
  expect(isoWeek({ y: 2026, m: 11, d: 31 })).toBe(53);
  expect(isoWeek({ y: 2027, m: 0, d: 1 })).toBe(53); // a Friday: it belongs to the last week of 2026
  expect(isoWeek({ y: 2026, m: 10, d: 17 })).toBe(47);
  expect(dayOfYear({ y: 2026, m: 0, d: 1 })).toBe(1);
  expect(dayOfYear({ y: 2026, m: 11, d: 31 })).toBe(365);
  expect(dayOfYear({ y: 2028, m: 11, d: 31 })).toBe(366);
  expect(sameDay({ y: 2026, m: 1, d: 3 }, { y: 2026, m: 1, d: 3 })).toBe(true);
  expect(sameDay({ y: 2026, m: 1, d: 3 }, { y: 2026, m: 2, d: 3 })).toBe(false);
});

test("today follows the time zone, not the machine's", () => {
  const t = new Date("2026-11-17T01:30:00Z");
  expect(todayIn(t, "UTC")).toEqual({ y: 2026, m: 10, d: 17 });
  expect(todayIn(t, "America/Sao_Paulo")).toEqual({ y: 2026, m: 10, d: 16 }); // still the evening before, three hours behind
  expect(todayIn(t, "Pacific/Auckland")).toEqual({ y: 2026, m: 10, d: 17 });
});

test("a zone's offset from UTC", () => {
  const t = new Date("2026-11-17T12:00:00Z");
  expect(zoneInfo(t, "America/Sao_Paulo", "en-US").offset).toBe("UTC-03:00");
  expect(zoneInfo(t, "UTC", "en-US").offset).toBe("UTC");
  expect(zoneInfo(t, "Asia/Kolkata", "en-US").offset).toBe("UTC+05:30");
  expect(zoneInfo(t, "Europe/Lisbon", "en-US").name).toBe("Europe/Lisbon");
});
