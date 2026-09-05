/** Timezone-aware date helpers for the bot (Intl only, no extra deps). Dates are "YYYY-MM-DD" strings. */
import { addDays, daysBetween } from "@/lib/scoring/dates";

function parts(d: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) out[p.type] = p.value;
  return out;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Calendar date of a unix timestamp (seconds) in the given IANA timezone. */
export function dateInTz(unixSeconds: number, tz: string): string {
  const p = parts(new Date(unixSeconds * 1000), tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Wall-clock time "HH:MM" of a unix timestamp (seconds) in the given IANA timezone. */
export function timeInTz(unixSeconds: number, tz: string): string {
  const p = parts(new Date(unixSeconds * 1000), tz);
  return `${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
}

/** Current date/time in the given timezone. `weekday`: 0 = Sunday. */
export function nowInTz(tz: string, now: Date = new Date()): { date: string; weekday: number; hour: number; minute: number } {
  const p = parts(now, tz);
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    weekday: WEEKDAYS.indexOf(p.weekday),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
  };
}

/** 0 = Monday … 6 = Sunday for a calendar date string. */
function isoWeekdayIndex(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Monday of the ISO week containing the date. */
export function mondayOf(dateStr: string): string {
  return addDays(dateStr, -isoWeekdayIndex(dateStr));
}

/** ISO week (Mon..Sun) containing the date. */
export function weekBounds(dateStr: string): { monday: string; sunday: string } {
  const monday = mondayOf(dateStr);
  return { monday, sunday: addDays(monday, 6) };
}

/** 1-based quest week; week 1 starts on the Monday of the week containing questStart. */
export function questWeekNumber(questStart: string, dateStr: string): number {
  return Math.floor(daysBetween(mondayOf(questStart), dateStr) / 7) + 1;
}

/** ISO-8601 week key, e.g. "2026-W36" (the week's year is that of its Thursday). */
export function periodKey(dateStr: string): string {
  const thursday = addDays(mondayOf(dateStr), 3);
  const year = Number(thursday.slice(0, 4));
  const week = Math.floor(daysBetween(mondayOf(`${year}-01-04`), thursday) / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}
