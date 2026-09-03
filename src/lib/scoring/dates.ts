/** Pure, timezone-independent date helpers working on "YYYY-MM-DD" strings. */

export const RU_MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
] as const;

const RU_WEEKDAYS_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"] as const;

function parse(d: string): [number, number, number] {
  const [y, m, day] = d.split("-").map(Number);
  return [y, m, day];
}

/** UTC-based YYYY-MM-DD from a Date. */
export function toDateStr(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(d: string, n: number): string {
  const [y, m, day] = parse(d);
  return toDateStr(new Date(Date.UTC(y, m - 1, day + n)));
}

/** Whole days from a to b (positive if b is after a). */
export function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = parse(a);
  const [yb, mb, db] = parse(b);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

/** Today's calendar date in the given IANA timezone as YYYY-MM-DD. */
export function todayInTz(tz: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** "2026-09-03" -> "3 сентября" */
export function formatRuDate(d: string): string {
  const [, m, day] = parse(d);
  return `${day} ${RU_MONTHS[m - 1]}`;
}

/** "2026-09-03" -> "чт" */
export function weekdayShortRu(d: string): string {
  const [y, m, day] = parse(d);
  return RU_WEEKDAYS_SHORT[new Date(Date.UTC(y, m - 1, day)).getUTCDay()];
}
