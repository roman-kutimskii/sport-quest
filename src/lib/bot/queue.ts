/** Pure scheduling predicates for the worker loops (scripts/bot.ts). No I/O, so they are unit-tested. */
import { addDays } from "@/lib/scoring/dates";
import { mondayOf } from "./dates";

export type QueueRow = { id: string; fromUserId: string; createdAt: Date };

/**
 * Which RECEIVED rows the process loop may start now. `rows` come ordered by createdAt.
 * A row waits while it is younger than `bufferMs` (album buffer), while it is already in flight,
 * or while another link of the same author is in flight (posts of one person run in order so the
 * same-day rules cannot race). At most `capacity` rows are returned.
 */
export function pickEligible(
  rows: QueueRow[],
  opts: { inFlightIds: ReadonlySet<string>; inFlightAuthors: ReadonlySet<string>; capacity: number; now: Date; bufferMs: number },
): QueueRow[] {
  const picked: QueueRow[] = [];
  const authors = new Set(opts.inFlightAuthors);
  const cutoff = opts.now.getTime() - opts.bufferMs;
  for (const row of [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    if (picked.length >= opts.capacity) break;
    if (opts.inFlightIds.has(row.id) || authors.has(row.fromUserId)) continue;
    if (row.createdAt.getTime() >= cutoff) continue;
    picked.push(row);
    authors.add(row.fromUserId);
  }
  return picked;
}

/** An announcement group goes out once its first row is at least `mergeSeconds` old, so late siblings can still merge. */
export function announcementReady(firstCreatedAt: Date, now: Date, mergeSeconds: number): boolean {
  return now.getTime() - firstCreatedAt.getTime() >= mergeSeconds * 1000;
}

/** "2026-W36" → Monday/Sunday of that ISO week; null for a malformed key. */
export function weekFromPeriodKey(key: string): { monday: string; sunday: string } | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!m) return null;
  const week = Number(m[2]);
  if (week < 1 || week > 53) return null;
  const monday = addDays(mondayOf(`${m[1]}-01-04`), (week - 1) * 7);
  return { monday, sunday: addDays(monday, 6) };
}

/** Wall-clock offset (ms) of `tz` at the given instant. */
function tzOffsetMs(at: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(at)) p[part.type] = part.value;
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return asUtc - at.getTime();
}

/** The instant at which `dateStr hour:minute` happens on the wall clock of `tz`. */
export function zonedTimeToUtc(dateStr: string, hour: number, minute: number, tz: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  let result = guess - tzOffsetMs(new Date(guess), tz);
  result = guess - tzOffsetMs(new Date(result), tz); // second pass for DST edges
  return new Date(result);
}
