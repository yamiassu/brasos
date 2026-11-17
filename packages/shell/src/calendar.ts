// Date math for the taskbar's calendar. Pure, so it is tested without a browser. A "day" here is a calendar date (year, month 0-11,
// day) in the shell's time zone; nothing converts a point in time except `todayIn`.
export type Day = { y: number; m: number; d: number };
export type Cell = Day & { inMonth: boolean };

/** today's calendar date in a time zone (the one from the preferences; the browser's own when none) */
export function todayIn(now: Date, timeZone?: string): Day {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month - 1, d: +p.day };
}

/** the first day of the week for a locale: 1 = Monday … 7 = Sunday (Chromium knows it; the fallback is Sunday) */
export function firstWeekday(locale?: string): number {
  try {
    const l = new Intl.Locale(locale || navigator.language) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
    return l.getWeekInfo?.().firstDay ?? l.weekInfo?.firstDay ?? 7;
  } catch {
    return 7;
  }
}

/** the six weeks that show a month, starting on `first` (1 Monday … 7 Sunday); days of the neighbouring months are marked */
export function monthGrid(y: number, m: number, first: number): Cell[][] {
  const start = new Date(Date.UTC(y, m, 1));
  const lead = (((start.getUTCDay() || 7) - first) % 7 + 7) % 7; // days of the previous month shown before the 1st
  const rows: Cell[][] = [];
  for (let r = 0; r < 6; r++) {
    rows.push(Array.from({ length: 7 }, (_, c) => {
      const t = new Date(Date.UTC(y, m, 1 - lead + r * 7 + c));
      return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(), inMonth: t.getUTCMonth() === m };
    }));
  }
  return rows;
}

/** the ISO 8601 week number (weeks start on Monday; week 1 holds the year's first Thursday) */
export function isoWeek({ y, m, d }: Day): number {
  const t = new Date(Date.UTC(y, m, d));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((+t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7);
}

/** 1 for 1 January */
export const dayOfYear = ({ y, m, d }: Day) => Math.round((Date.UTC(y, m, d) - Date.UTC(y, 0, 1)) / 86_400_000) + 1;

export const sameDay = (a: Day, b: Day) => a.y === b.y && a.m === b.m && a.d === b.d;

/** a zone's name, its offset from UTC at this moment ("UTC-03:00") and its abbreviation, as the browser knows them */
export function zoneInfo(now: Date, timeZone?: string, locale?: string): { name: string; offset: string; short: string } {
  const part = (timeZoneName: Intl.DateTimeFormatOptions["timeZoneName"]) =>
    new Intl.DateTimeFormat(locale, { timeZone, timeZoneName }).formatToParts(now).find((x) => x.type === "timeZoneName")?.value ?? "";
  const off = part("longOffset"); // "GMT-03:00", or "GMT" for UTC
  return {
    name: timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    offset: /^(GMT|UTC)?([+-]00:00)?$/.test(off) ? "UTC" : off.replace("GMT", "UTC"), // "GMT", "GMT+00:00" and "" all mean UTC itself
    short: part("short"),
  };
}
