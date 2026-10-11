// All calendar math happens in ICT (Asia/Ho_Chi_Minh, UTC+7, no DST).
// Dates are passed around as "YYYY-MM-DD" strings, which sort and compare correctly in SQL.

const ICT_OFFSET_MS = 7 * 60 * 60 * 1000;

export interface YearMonth {
  year: number;
  month: number; // 1-12
}

/** A Date whose UTC fields read as the current ICT wall-clock time. */
export function nowIct(now: Date = new Date()): Date {
  return new Date(now.getTime() + ICT_OFFSET_MS);
}

export function todayIct(now: Date = new Date()): string {
  return nowIct(now).toISOString().slice(0, 10);
}

export function currentMonthIct(now: Date = new Date()): YearMonth {
  const d = nowIct(now);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

export function toYmd(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Returns the date string, or null if the day does not exist (e.g. 31/02). */
export function validYmd(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1) return null;
  return toYmd(year, month, day);
}

export function monthRange({ year, month }: YearMonth): { from: string; to: string } {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: toYmd(year, month, 1), to: toYmd(year, month, lastDay) };
}

/** { year: 2026, month: 10 } -> "2026-10" */
export function monthKey({ year, month }: YearMonth): string {
  return `${String(year).padStart(4, "0")}-${pad2(month)}`;
}

export function previousMonth({ year, month }: YearMonth): YearMonth {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/** "2026-10-08" -> "08/10" */
export function formatDayMonth(ymd: string): string {
  return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
