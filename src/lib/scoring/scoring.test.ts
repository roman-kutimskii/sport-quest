import { describe, expect, it } from "vitest";
import { computeScore, type ScoringReport } from "./index";
import { addDays, daysBetween, formatRuDate, todayInTz, toDateStr, weekdayShortRu } from "./dates";

const START = "2026-09-03";
const END = "2026-11-30";

let seq = 0;
const act = (date: string, over: Partial<ScoringReport> = {}): ScoringReport => ({
  id: `r${String(++seq).padStart(4, "0")}`,
  kind: "ACTIVITY",
  date,
  status: "APPROVED",
  ...over,
});
const activeRun = (n: number, from = START) => Array.from({ length: n }, (_, i) => act(addDays(from, i)));
const score = (reports: ScoringReport[], today: string, adjustments: { delta: number }[] = []) =>
  computeScore({ reports, adjustments, questStart: START, questEnd: END, today });

describe("dates", () => {
  it("addDays crosses month boundaries", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-09-03", "2026-11-30")).toBe(88);
    expect(toDateStr(new Date(Date.UTC(2026, 0, 5)))).toBe("2026-01-05");
  });
  it("russian formatting", () => {
    expect(formatRuDate("2026-09-03")).toBe("3 сентября");
    expect(weekdayShortRu("2026-09-03")).toBe("чт");
  });
  it("todayInTz respects timezone", () => {
    const now = new Date("2026-09-03T22:30:00Z");
    expect(todayInTz("Europe/Moscow", now)).toBe("2026-09-04");
    expect(todayInTz("UTC", now)).toBe("2026-09-03");
  });
});

describe("streaks", () => {
  it("7-day streak -> 10 bonus (highest only) and invulnerable for 7 days", () => {
    const today = addDays(START, 6);
    const r = score(activeRun(7), today);
    expect(r.streakBonus).toBe(10);
    expect(r.awards.map((a) => a.type)).toEqual(["STREAK_3", "STREAK_5", "STREAK_7"]);
    expect(r.awards.map((a) => a.pumpkins)).toEqual([2, 3, 5]);
    expect(r.awards[2].date).toBe(today);
    expect(r.invulnerableUntil).toBe(addDays(today, 6));
    expect(r.currentStreak).toBe(7);
    expect(r.total).toBe(7 + 10);
    // still invulnerable on day 6 after the award, not on day 7
    expect(score(activeRun(7), addDays(today, 6)).invulnerableUntil).toBe(addDays(today, 6));
    expect(score(activeRun(7), addDays(today, 7)).invulnerableUntil).toBeNull();
  });
  it("3-day -> 2, 5-day -> 5, 6-day -> 5 (highest milestone only)", () => {
    expect(score(activeRun(3), addDays(START, 2)).streakBonus).toBe(2);
    expect(score(activeRun(4), addDays(START, 3)).streakBonus).toBe(2);
    expect(score(activeRun(5), addDays(START, 4)).streakBonus).toBe(5);
    expect(score(activeRun(6), addDays(START, 5)).streakBonus).toBe(5);
  });
  it("counter resets after 7: 8-day -> 10, 10-day -> 12, 12-day -> 15, 14-day -> 20", () => {
    expect(score(activeRun(8), addDays(START, 7)).streakBonus).toBe(10);
    const r10 = score(activeRun(10), addDays(START, 9));
    expect(r10.streakBonus).toBe(12);
    expect(r10.currentStreak).toBe(10);
    expect(score(activeRun(12), addDays(START, 11)).streakBonus).toBe(15);
    expect(score(activeRun(14), addDays(START, 13)).streakBonus).toBe(20);
  });
  it("broken streak keeps the bonus already earned and starts over", () => {
    // 5 active days (+5), gap, then 3 active days (+2)
    const reports = [...activeRun(5), ...activeRun(3, addDays(START, 6))];
    const r = score(reports, addDays(START, 8));
    expect(r.streakBonus).toBe(7);
    expect(r.currentStreak).toBe(3);
  });
  it("gap resets streak", () => {
    // days 0,1 active, day 2 skipped, days 3,4 active -> no award
    const reports = [act(START), act(addDays(START, 1)), act(addDays(START, 3)), act(addDays(START, 4))];
    const r = score(reports, addDays(START, 4));
    expect(r.streakBonus).toBe(0);
    expect(r.currentStreak).toBe(2);
    expect(r.activeDayCount).toBe(4);
  });
  it("today not active but yesterday active -> currentStreak continues", () => {
    const r = score(activeRun(4), addDays(START, 4));
    expect(r.currentStreak).toBe(4);
    expect(r.dayMap[addDays(START, 4)].active).toBe(false);
  });
  it("neither today nor yesterday active -> currentStreak 0", () => {
    expect(score(activeRun(4), addDays(START, 5)).currentStreak).toBe(0);
  });
  it("does not count days after today (retroactive future data ignored)", () => {
    const r = score(activeRun(7), addDays(START, 2));
    expect(r.streakBonus).toBe(2);
    expect(Object.keys(r.dayMap)).toHaveLength(3);
  });
});

describe("activity detection", () => {
  it("steps >= 10000 without ACTIVITY makes day active; less does not", () => {
    const r = score(
      [act(START, { kind: "STEPS", steps: 10000 }), act(addDays(START, 1), { kind: "STEPS", steps: 9999 })],
      addDays(START, 1),
    );
    expect(r.activeDays).toEqual([START]);
  });
  it("steps are max per day, summed across days", () => {
    const r = score(
      [act(START, { steps: 4000 }), act(START, { kind: "STEPS", steps: 12000 }), act(addDays(START, 1), { steps: 3000 })],
      addDays(START, 1),
    );
    expect(r.totalSteps).toBe(15000);
    expect(r.dayMap[START].steps).toBe(12000);
  });
  it("pending/rejected ignored; pending flag in dayMap", () => {
    const r = score(
      [act(START, { status: "PENDING" }), act(addDays(START, 1), { status: "REJECTED" }), act(addDays(START, 2))],
      addDays(START, 2),
    );
    expect(r.activeDays).toEqual([addDays(START, 2)]);
    expect(r.dayMap[START]).toMatchObject({ active: false, pending: true });
    expect(r.dayMap[addDays(START, 1)].pending).toBeUndefined();
  });
  it("days outside quest range ignored", () => {
    const r = score([act("2026-09-02"), act("2026-12-01"), act(START)], "2026-12-05");
    expect(r.activeDays).toEqual([START]);
    expect(Object.keys(r.dayMap)[0]).toBe(START);
    expect(Object.keys(r.dayMap).at(-1)).toBe(END);
    expect(r.currentStreak).toBe(0);
  });
  it("multiple activities on one day give 1 pumpkin", () => {
    expect(score([act(START), act(START)], START).total).toBe(1);
  });
});

describe("bingo", () => {
  it("3 points each, deduped by key (first by date wins)", () => {
    const r = score(
      [act(START, { kind: "BINGO", bingoKey: "tea" }), act(addDays(START, 1), { kind: "BINGO", bingoKey: "tea" })],
      addDays(START, 1),
    );
    expect(r.bingoCompleted).toHaveLength(1);
    expect(r.bingoCompleted[0].date).toBe(START);
    expect(r.bingoPoints).toBe(3);
    expect(r.activeDays).toEqual([START, addDays(START, 1)]); // bingo alone makes the day active
    expect(r.dayMap[START].bingoKey).toBe("tea");
  });
  it("two bingo on same day -> only first by id counts", () => {
    const r = score(
      [
        { id: "b2", kind: "BINGO", date: START, status: "APPROVED", bingoKey: "zen" },
        { id: "b1", kind: "BINGO", date: START, status: "APPROVED", bingoKey: "tea" },
        { id: "b3", kind: "BINGO", date: addDays(START, 1), status: "APPROVED", bingoKey: "zen" },
      ],
      addDays(START, 1),
    );
    expect(r.bingoCompleted.map((b) => b.key)).toEqual(["tea", "zen"]);
    expect(r.bingoCompleted[0].reportId).toBe("b1");
  });
  it("unknown keys ignored", () => {
    expect(score([act(START, { kind: "BINGO", bingoKey: "nope" })], START).bingoPoints).toBe(0);
  });
  it("bingo day counts as active and contributes to streaks", () => {
    const reports = [act(START), act(addDays(START, 1), { kind: "BINGO", bingoKey: "tea" }), act(addDays(START, 2))];
    const r = score(reports, addDays(START, 2));
    expect(r.activeDayCount).toBe(3);
    expect(r.streakBonus).toBe(2);
    expect(r.total).toBe(3 + 2 + 3);
  });
});

describe("total", () => {
  it("adjustments and total", () => {
    const reports = [...activeRun(3), act(addDays(START, 1), { kind: "BINGO", bingoKey: "early" })];
    const r = score(reports, addDays(START, 2), [{ delta: 5 }, { delta: -2 }]);
    expect(r.adjustments).toBe(3);
    expect(r.total).toBe(3 + 2 + 3 + 3); // 3 active days + streak_3 + bingo + adjustments
  });
  it("dayMap shape", () => {
    const r = score([act(START, { steps: 500 })], addDays(START, 1));
    expect(r.dayMap[START]).toEqual({ active: true, awards: [], steps: 500 });
    expect(r.dayMap[addDays(START, 1)]).toEqual({ active: false, awards: [] });
    expect(score(activeRun(3), addDays(START, 2)).dayMap[addDays(START, 2)].awards).toEqual(["STREAK_3"]);
  });
});
