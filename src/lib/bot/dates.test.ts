import { describe, expect, it } from "vitest";
import { dateInTz, nowInTz, periodKey, questWeekNumber, timeInTz, weekBounds } from "./dates";

const TZ = "Europe/Moscow";

describe("dateInTz / timeInTz", () => {
  it("00:30 Moscow is 21:30 UTC of the previous day", () => {
    const ts = Date.UTC(2026, 8, 3, 21, 30) / 1000; // 2026-09-03T21:30Z
    expect(dateInTz(ts, TZ)).toBe("2026-09-04");
    expect(timeInTz(ts, TZ)).toBe("00:30");
    expect(dateInTz(ts, "UTC")).toBe("2026-09-03");
  });

  it("nowInTz reports weekday with Sunday = 0", () => {
    const n = nowInTz(TZ, new Date(Date.UTC(2026, 8, 6, 17, 5))); // Sunday 20:05 Moscow
    expect(n).toEqual({ date: "2026-09-06", weekday: 0, hour: 20, minute: 5 });
  });
});

describe("weekBounds", () => {
  it("spans a month boundary", () => {
    expect(weekBounds("2026-09-01")).toEqual({ monday: "2026-08-31", sunday: "2026-09-06" });
    expect(weekBounds("2026-09-06")).toEqual({ monday: "2026-08-31", sunday: "2026-09-06" });
    expect(weekBounds("2026-09-07")).toEqual({ monday: "2026-09-07", sunday: "2026-09-13" });
  });
});

describe("periodKey", () => {
  it("uses ISO-8601 weeks around new year", () => {
    expect(periodKey("2026-09-03")).toBe("2026-W36");
    expect(periodKey("2026-12-31")).toBe("2026-W53");
    expect(periodKey("2027-01-01")).toBe("2026-W53");
    expect(periodKey("2027-01-04")).toBe("2027-W01");
    expect(periodKey("2024-12-30")).toBe("2025-W01");
    expect(periodKey("2021-01-03")).toBe("2020-W53");
  });
});

describe("questWeekNumber", () => {
  it("counts from the Monday of the quest's first week", () => {
    expect(questWeekNumber("2026-09-03", "2026-09-03")).toBe(1);
    expect(questWeekNumber("2026-09-03", "2026-09-06")).toBe(1);
    expect(questWeekNumber("2026-09-03", "2026-09-07")).toBe(2);
    expect(questWeekNumber("2026-09-03", "2026-09-20")).toBe(3);
  });
});
