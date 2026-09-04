import { BINGO_POINTS, isBingoKey } from "@/lib/bingo";
import { addDays } from "./dates";

export { addDays, daysBetween, todayInTz, toDateStr, formatRuDate, weekdayShortRu, RU_MONTHS } from "./dates";

export type ScoringReport = {
  id: string;
  kind: "ACTIVITY" | "BINGO" | "STEPS";
  date: string; // "YYYY-MM-DD"
  status: "PENDING" | "APPROVED" | "REJECTED";
  bingoKey?: string | null;
  steps?: number | null;
};
export type ScoringAdjustment = { delta: number };
export type ScoringInput = {
  reports: ScoringReport[];
  adjustments: ScoringAdjustment[];
  questStart: string;
  questEnd: string;
  today: string;
};
export type StreakAward = { type: "STREAK_3" | "STREAK_5" | "STREAK_7"; date: string; pumpkins: number };
export type DayInfo = {
  active: boolean;
  bingoKey?: string;
  awards: StreakAward["type"][];
  steps?: number;
  pending?: boolean;
};
export type ScoreBreakdown = {
  activeDays: string[];
  activeDayCount: number;
  streakBonus: number;
  awards: StreakAward[];
  bingoCompleted: { key: string; date: string; reportId: string }[];
  bingoPoints: number;
  adjustments: number;
  total: number;
  currentStreak: number;
  totalSteps: number;
  invulnerableUntil: string | null;
  dayMap: Record<string, DayInfo>;
};

export const STEPS_ACTIVE_THRESHOLD = 10_000;
// Only the highest milestone reached within one streak counts (3 → 2, 5 → 5, 7 → 10, not summed).
// `pumpkins` on an award is the increment over the previous milestone so awards sum to the highest value.
export const STREAK_MILESTONES: Record<number, { type: StreakAward["type"]; total: number }> = {
  3: { type: "STREAK_3", total: 2 },
  5: { type: "STREAK_5", total: 5 },
  7: { type: "STREAK_7", total: 10 },
};
export const INVULNERABLE_DAYS = 7;

const inRange = (d: string, start: string, end: string) => d >= start && d <= end;
const byDateThenId = (a: ScoringReport, b: ScoringReport) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function computeScore(input: ScoringInput): ScoreBreakdown {
  const { questStart, questEnd, today } = input;
  const lastDay = today < questEnd ? today : questEnd;

  const approved = input.reports
    .filter((r) => r.status === "APPROVED" && inRange(r.date, questStart, questEnd))
    .sort(byDateThenId);
  const pendingDays = new Set(
    input.reports
      .filter((r) => r.status === "PENDING" && inRange(r.date, questStart, questEnd))
      .map((r) => r.date),
  );

  // Active days + steps (max per day)
  const activeSet = new Set<string>();
  const stepsByDay = new Map<string, number>();
  for (const r of approved) {
    const steps = r.steps ?? 0;
    if (steps > 0) stepsByDay.set(r.date, Math.max(stepsByDay.get(r.date) ?? 0, steps));
    if (r.kind === "ACTIVITY" || r.kind === "BINGO" || steps >= STEPS_ACTIVE_THRESHOLD) activeSet.add(r.date);
  }
  const activeDays = [...activeSet].sort();
  let totalSteps = 0;
  for (const s of stepsByDay.values()) totalSteps += s;

  // Bingo: one per key, one per date; first by (date, id) wins
  const bingoCompleted: ScoreBreakdown["bingoCompleted"] = [];
  const usedKeys = new Set<string>();
  const usedDates = new Set<string>();
  for (const r of approved) {
    if (r.kind !== "BINGO" || !r.bingoKey || !isBingoKey(r.bingoKey)) continue;
    if (usedKeys.has(r.bingoKey) || usedDates.has(r.date)) continue;
    usedKeys.add(r.bingoKey);
    usedDates.add(r.date);
    bingoCompleted.push({ key: r.bingoKey, date: r.date, reportId: r.id });
  }
  const bingoByDate = new Map(bingoCompleted.map((b) => [b.date, b.key]));

  // Streak walk
  const awards: StreakAward[] = [];
  const dayMap: Record<string, DayInfo> = {};
  let counter = 0; // resetting award counter
  let awardedInStreak = 0; // highest milestone value already granted in the current counter cycle
  let raw = 0; // real consecutive count
  let currentStreak = 0;
  let lastStreak7: string | null = null;
  for (let d = questStart; d <= lastDay; d = addDays(d, 1)) {
    const active = activeSet.has(d);
    const info: DayInfo = { active, awards: [] };
    if (active) {
      counter += 1;
      raw += 1;
      const award = STREAK_MILESTONES[counter];
      if (award) {
        awards.push({ type: award.type, date: d, pumpkins: award.total - awardedInStreak });
        awardedInStreak = award.total;
        info.awards.push(award.type);
        if (award.type === "STREAK_7") {
          lastStreak7 = d;
          counter = 0;
          awardedInStreak = 0;
        }
      }
      currentStreak = raw;
    } else {
      counter = 0;
      raw = 0;
      awardedInStreak = 0;
      // Today being inactive does not break the displayed streak (ending yesterday).
      if (d !== today) currentStreak = 0;
      if (pendingDays.has(d)) info.pending = true;
    }
    const bk = bingoByDate.get(d);
    if (bk) info.bingoKey = bk;
    const st = stepsByDay.get(d);
    if (st !== undefined) info.steps = st;
    dayMap[d] = info;
  }
  if (today > questEnd) currentStreak = 0;

  const streakBonus = awards.reduce((s, a) => s + a.pumpkins, 0);
  const bingoPoints = bingoCompleted.length * BINGO_POINTS;
  const adjustments = input.adjustments.reduce((s, a) => s + a.delta, 0);
  const activeDayCount = activeDays.length;

  let invulnerableUntil: string | null = null;
  if (lastStreak7) {
    const until = addDays(lastStreak7, INVULNERABLE_DAYS - 1);
    if (until >= today) invulnerableUntil = until;
  }

  return {
    activeDays,
    activeDayCount,
    streakBonus,
    awards,
    bingoCompleted,
    bingoPoints,
    adjustments,
    total: activeDayCount + streakBonus + bingoPoints + adjustments,
    currentStreak,
    totalSteps,
    invulnerableUntil,
    dayMap,
  };
}
