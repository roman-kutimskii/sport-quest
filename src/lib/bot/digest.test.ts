import { describe, expect, it } from "vitest";
import type { ScoringReport } from "@/lib/scoring";
import { computeDigest, renderDigest, type DigestInput, type DigestUser } from "./digest";

let seq = 0;
const act = (date: string, steps?: number): ScoringReport => ({ id: `r${++seq}`, kind: "ACTIVITY", date, status: "APPROVED", steps: steps ?? null });
const bingo = (date: string, key: string): ScoringReport => ({ id: `r${++seq}`, kind: "BINGO", date, status: "APPROVED", bingoKey: key });
const stepsOnly = (date: string, steps: number): ScoringReport => ({ id: `r${++seq}`, kind: "STEPS", date, status: "APPROVED", steps });
const user = (name: string, reports: ScoringReport[], isActive = true): DigestUser => ({
  id: name,
  name,
  avatarEmoji: "🎃",
  isActive,
  reports,
  adjustments: [],
});

const users: DigestUser[] = [
  // streak 3..10 Sep (bingo day 3 Sep counts) crossing into the week (7..13 Sep); bingo closed earlier and this week
  user("Аня", [
    ...["2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07"].map((d) => act(d)),
    act("2026-09-08", 10000),
    act("2026-09-09", 12000),
    act("2026-09-10"),
    bingo("2026-09-03", "armor"),
    bingo("2026-09-09", "stairs"),
  ]),
  // ties with Аня for 4 active days this week; a steps-only day
  user("Боря", [act("2026-09-07", 30000), act("2026-09-08"), act("2026-09-09"), act("2026-09-10"), stepsOnly("2026-09-11", 5000)]),
  user("Вера", []),
  user("Гриша", ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"].map((d) => act(d, 20000)), false),
  user("Даня", [bingo("2026-09-02", "leaves")]),
];

const base: Omit<DigestInput, "users"> = {
  questStart: "2026-09-01",
  questEnd: "2026-10-31",
  weekMonday: "2026-09-07",
  weekSunday: "2026-09-13",
  cutoff: "2026-09-13T20:00",
  today: "2026-09-13",
};

describe("computeDigest", () => {
  const d = computeDigest({ ...base, users });

  it("header", () => {
    expect(d.weekNumber).toBe(2);
    expect(d.daysLeft).toBe(48);
    expect(d.cutoff).toBe("2026-09-13T20:00");
  });

  it("top-5 with weekly delta, inactive excluded", () => {
    expect(d.top).toEqual([
      { name: "Аня", total: 24, delta: 15 }, // 8 days + 10 streak + 2 bingo; before the week: 4 + 2 + 3 = 9
      { name: "Боря", total: 6, delta: 6 },
      { name: "Даня", total: 4, delta: 0 },
      { name: "Вера", total: 0, delta: 0 },
    ]);
    expect(JSON.stringify(d)).not.toContain("Гриша");
  });

  it("most active lists ties", () => {
    expect(d.mostActive).toEqual({ names: ["Аня", "Боря"], days: 4 });
  });

  it("streak milestones within the week and invulnerable holders", () => {
    expect(d.streakMilestones).toEqual([
      { name: "Аня", type: "STREAK_5", date: "2026-09-07" },
      { name: "Аня", type: "STREAK_7", date: "2026-09-09" },
      { name: "Боря", type: "STREAK_3", date: "2026-09-09" },
    ]);
    expect(d.invulnerable).toEqual(["Аня"]);
  });

  it("bingo closed this week only", () => {
    expect(d.bingoClosed).toEqual([{ key: "stairs", title: "Лифтофобия", emoji: "🪜", names: ["Аня"] }]);
    expect(d.bingoMasters).toEqual([]);
  });

  it("steps", () => {
    expect(d.steps).toEqual({ weekTotal: 57000, top: [{ name: "Боря", steps: 35000 }, { name: "Аня", steps: 22000 }] });
  });

  it("participation counts active users only", () => {
    expect(d.participation).toEqual({ active: 2, total: 4 });
  });

  it("ignores reports dated after weekSunday", () => {
    const late = computeDigest({ ...base, users: [user("Юля", [act("2026-09-14"), act("2026-09-15"), act("2026-09-16")])] });
    expect(late.top[0]).toEqual({ name: "Юля", total: 0, delta: 0 });
    expect(late.mostActive).toBeNull();
  });

  it("invulnerable expires", () => {
    const later = computeDigest({ ...base, weekMonday: "2026-09-21", weekSunday: "2026-09-27", today: "2026-09-27", users });
    expect(later.invulnerable).toEqual([]);
    expect(later.weekNumber).toBe(4);
  });
});

describe("renderDigest", () => {
  it("renders every section", () => {
    const s = renderDigest(computeDigest({ ...base, users }), { comment: "Аня, ты машина!" });
    expect(s).toContain("Итоги недели 2 (по состоянию на 13 сен 20:00)");
    expect(s).toContain("До конца квеста 48 дней");
    expect(s).toContain("1. Аня — 24 🎃 (+15)");
    expect(s).toContain("4. Вера — 0 🎃 (0)");
    expect(s).toContain("Аня, Боря — 4 активных дня");
    expect(s).toContain("Аня — 7 дней (9 сен)");
    expect(s).toContain("🛡 Неуязвимые: Аня");
    expect(s).toContain("🪜 «Лифтофобия» — Аня");
    expect(s).toContain("Всего за неделю: 57 000");
    expect(s).toContain("1. Боря — 35 000");
    expect(s).toContain("👥 2 из 4 участников отметились на этой неделе");
    expect(s).toContain("💬 Комментарий недели: Аня, ты машина!");
    expect(s).not.toContain("Гриша");
  });

  it("week with no reports renders gracefully", () => {
    const d = computeDigest({ ...base, weekMonday: "2026-09-14", weekSunday: "2026-09-20", today: "2026-09-20", users: [user("Даня", [bingo("2026-09-02", "leaves")]), user("Вера", [])] });
    const s = renderDigest(d);
    expect(d.mostActive).toBeNull();
    expect(s).toContain("1. Даня — 4 🎃 (0)");
    expect(s.match(/пока пусто/g)?.length).toBe(4);
    expect(s).toContain("👥 0 из 2 участников отметились на этой неделе");
    expect(s).not.toContain("Комментарий недели");
  });

  it("no users at all", () => {
    const s = renderDigest(computeDigest({ ...base, users: [] }));
    expect(s).toContain("🏆 Топ-5\nпока пусто");
    expect(s).toContain("0 из 0 участников");
  });
});
