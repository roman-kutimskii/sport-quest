/**
 * Weekly digest: deterministic compute from scoring data + Russian rendering. Pure, no I/O.
 *
 * The caller is responsible for the 20:00 cutoff: pass only reports created before `cutoff`.
 * Reports dated after `weekSunday` are ignored for "this week" numbers by construction
 * (scores are computed with `today = weekSunday`).
 */
import { BINGO_TASKS } from "@/lib/bingo";
import { computeScore, type ScoringReport } from "@/lib/scoring";
import { addDays, daysBetween } from "@/lib/scoring/dates";
import { fmtDateShort, fmtSteps, pluralRu } from "./text";

export type DigestUser = {
  id: string;
  name: string;
  avatarEmoji: string;
  isActive: boolean;
  reports: ScoringReport[];
  adjustments: { delta: number }[];
};

export type DigestInput = {
  questStart: string;
  questEnd: string;
  weekMonday: string;
  weekSunday: string;
  /** Label only, e.g. "2026-09-06T20:00". */
  cutoff: string;
  today: string;
  users: DigestUser[];
};

export type StreakType = "STREAK_3" | "STREAK_5" | "STREAK_7";

export type DigestData = {
  /** Copied from DigestInput.cutoff; rendered as «по состоянию на …». */
  cutoff: string;
  weekNumber: number;
  daysLeft: number;
  top: { name: string; total: number; delta: number }[];
  mostActive: { names: string[]; days: number } | null;
  streakMilestones: { name: string; type: StreakType; date: string }[];
  invulnerable: string[];
  bingoClosed: { key: string; title: string; emoji: string; names: string[] }[];
  bingoMasters: string[];
  steps: { weekTotal: number; top: { name: string; steps: number }[] };
  participation: { active: number; total: number };
};

const byName = (a: string, b: string) => a.localeCompare(b, "ru");

/** Monday of the ISO week containing d. */
function mondayOf(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay(); // 0 = Sun
  return addDays(d, dow === 0 ? -6 : 1 - dow);
}

export function computeDigest(input: DigestInput): DigestData {
  const { questStart, questEnd, weekMonday, weekSunday, today } = input;
  const inWeek = (d: string) => d >= weekMonday && d <= weekSunday;
  const users = input.users.filter((u) => u.isActive);

  const weekNumber = Math.max(1, Math.floor(daysBetween(mondayOf(questStart), weekMonday) / 7) + 1);
  const daysLeft = Math.max(0, daysBetween(today, questEnd));

  const prevDay = addDays(weekMonday, -1);
  const rows = users.map((u) => {
    // computeScore counts every approved report regardless of `today`, so clip by date explicitly.
    const asOf = (day: string) =>
      computeScore({ reports: u.reports.filter((r) => r.date <= day), adjustments: u.adjustments, questStart, questEnd, today: day });
    const now = asOf(weekSunday);
    const prevTotal = prevDay < questStart ? 0 : asOf(prevDay).total;
    const weekDays = now.activeDays.filter(inWeek).length;
    let weekSteps = 0;
    for (const [d, info] of Object.entries(now.dayMap)) if (inWeek(d) && info.steps) weekSteps += info.steps;
    return { u, now, delta: now.total - prevTotal, weekDays, weekSteps };
  });

  const top = [...rows]
    .sort((a, b) => b.now.total - a.now.total || byName(a.u.name, b.u.name))
    .slice(0, 5)
    .map((r) => ({ name: r.u.name, total: r.now.total, delta: r.delta }));

  const maxDays = rows.reduce((m, r) => Math.max(m, r.weekDays), 0);
  const mostActive =
    maxDays > 0
      ? { names: rows.filter((r) => r.weekDays === maxDays).map((r) => r.u.name).sort(byName), days: maxDays }
      : null;

  const streakMilestones = rows
    .flatMap((r) => r.now.awards.filter((a) => inWeek(a.date)).map((a) => ({ name: r.u.name, type: a.type, date: a.date })))
    .sort((a, b) => a.date.localeCompare(b.date) || byName(a.name, b.name));

  const invulnerable = rows
    .filter((r) => r.now.invulnerableUntil && r.now.invulnerableUntil >= today)
    .map((r) => r.u.name)
    .sort(byName);

  const bingoClosed = BINGO_TASKS.map((t) => ({
    key: t.key,
    title: t.title,
    emoji: t.emoji,
    names: rows
      .filter((r) => r.now.bingoCompleted.some((b) => b.key === t.key && inWeek(b.date)))
      .map((r) => r.u.name)
      .sort(byName),
  })).filter((b) => b.names.length);

  const bingoMasters = rows
    .filter((r) => r.now.bingoCompleted.length >= BINGO_TASKS.length)
    .map((r) => r.u.name)
    .sort(byName);

  const steps = {
    weekTotal: rows.reduce((s, r) => s + r.weekSteps, 0),
    top: rows
      .filter((r) => r.weekSteps > 0)
      .sort((a, b) => b.weekSteps - a.weekSteps || byName(a.u.name, b.u.name))
      .slice(0, 3)
      .map((r) => ({ name: r.u.name, steps: r.weekSteps })),
  };

  const participation = { active: rows.filter((r) => r.weekDays > 0).length, total: rows.length };

  return { cutoff: input.cutoff, weekNumber, daysLeft, top, mostActive, streakMilestones, invulnerable, bingoClosed, bingoMasters, steps, participation };
}

const MILESTONE_LABEL: Record<StreakType, string> = { STREAK_3: "3 дня", STREAK_5: "5 дней", STREAK_7: "7 дней" };
const EMPTY = "пока пусто";

/** "2026-09-06T20:00" → "6 сен 20:00" (falls back to the raw label). */
function fmtCutoff(cutoff: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(cutoff);
  if (!m) return cutoff;
  return m[2] ? `${fmtDateShort(m[1])} ${m[2]}` : fmtDateShort(m[1]);
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const list = (names: string[]) => names.join(", ");

export function renderDigest(d: DigestData, opts?: { comment?: string | null }): string {
  const out: string[] = [];
  out.push(`🎃 Итоги недели ${d.weekNumber} (по состоянию на ${d.cutoff ? fmtCutoff(d.cutoff) : "20:00"})`);
  out.push(d.daysLeft > 0 ? `До конца квеста ${pluralRu(d.daysLeft, "день", "дня", "дней")}` : "Квест завершён 🏁");

  out.push("");
  out.push("🏆 Топ-5");
  if (d.top.length) d.top.forEach((r, i) => out.push(`${i + 1}. ${r.name} — ${r.total} 🎃 (${signed(r.delta)})`));
  else out.push(EMPTY);

  out.push("");
  out.push("⚡️ Самые активные");
  out.push(d.mostActive ? `${list(d.mostActive.names)} — ${pluralRu(d.mostActive.days, "активный день", "активных дня", "активных дней")}` : EMPTY);

  out.push("");
  out.push("🔥 Стрики");
  if (d.streakMilestones.length) {
    for (const m of d.streakMilestones) out.push(`${m.name} — ${MILESTONE_LABEL[m.type]} (${fmtDateShort(m.date)})`);
  } else out.push(EMPTY);
  if (d.invulnerable.length) out.push(`🛡 Неуязвимые: ${list(d.invulnerable)}`);

  out.push("");
  out.push("🎯 Бинго");
  if (d.bingoClosed.length) for (const b of d.bingoClosed) out.push(`${b.emoji} «${b.title}» — ${list(b.names)}`);
  else out.push(EMPTY);
  if (d.bingoMasters.length) out.push(`🌟 Все 9/9: ${list(d.bingoMasters)}`);

  out.push("");
  out.push("🚶 Шаги");
  if (d.steps.weekTotal > 0) {
    out.push(`Всего за неделю: ${fmtSteps(d.steps.weekTotal)}`);
    d.steps.top.forEach((s, i) => out.push(`${i + 1}. ${s.name} — ${fmtSteps(s.steps)}`));
  } else out.push(EMPTY);

  out.push("");
  out.push(
    `👥 ${d.participation.active} из ${pluralRu(d.participation.total, "участника", "участников", "участников")} отметились на этой неделе`,
  );

  if (opts?.comment?.trim()) {
    out.push("");
    out.push(`💬 Комментарий недели: ${opts.comment.trim()}`);
  }
  return out.join("\n");
}
