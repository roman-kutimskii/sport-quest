import { describe, expect, it } from "vitest";
import { announcementReady, pickEligible, weekFromPeriodKey, zonedTimeToUtc } from "./queue";

const T0 = 1_700_000_000_000;
const row = (id: string, author: string, ageSec: number) => ({ id, fromUserId: author, createdAt: new Date(T0 - ageSec * 1000) });
const now = new Date(T0);
const base = { inFlightIds: new Set<string>(), inFlightAuthors: new Set<string>(), capacity: 3, now, bufferMs: 3000 };

describe("pickEligible", () => {
  it("returns oldest rows first up to capacity", () => {
    const picked = pickEligible([row("c", "u3", 10), row("a", "u1", 30), row("b", "u2", 20), row("d", "u4", 5)], base);
    expect(picked.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("holds rows younger than the album buffer", () => {
    const picked = pickEligible([row("old", "u1", 4), row("fresh", "u2", 2)], base);
    expect(picked.map((r) => r.id)).toEqual(["old"]);
  });

  it("never runs two links of one author at once, including authors already in flight", () => {
    const picked = pickEligible([row("a1", "u1", 30), row("a2", "u1", 20), row("b1", "u2", 10)], { ...base, inFlightAuthors: new Set(["u2"]) });
    expect(picked.map((r) => r.id)).toEqual(["a1"]);
  });

  it("skips rows already in flight", () => {
    const picked = pickEligible([row("a", "u1", 30), row("b", "u2", 20)], { ...base, inFlightIds: new Set(["a"]), inFlightAuthors: new Set(["u1"]) });
    expect(picked.map((r) => r.id)).toEqual(["b"]);
  });

  it("returns nothing when there is no capacity", () => {
    expect(pickEligible([row("a", "u1", 30)], { ...base, capacity: 0 })).toEqual([]);
  });
});

describe("announcementReady", () => {
  it("waits until the first row is mergeSeconds old", () => {
    expect(announcementReady(new Date(T0 - 59_000), now, 60)).toBe(false);
    expect(announcementReady(new Date(T0 - 60_000), now, 60)).toBe(true);
    expect(announcementReady(new Date(T0 - 3_600_000), now, 60)).toBe(true);
  });
});

describe("weekFromPeriodKey", () => {
  it("maps ISO week keys to Monday..Sunday", () => {
    expect(weekFromPeriodKey("2026-W36")).toEqual({ monday: "2026-08-31", sunday: "2026-09-06" });
    expect(weekFromPeriodKey("2026-W01")).toEqual({ monday: "2025-12-29", sunday: "2026-01-04" });
    expect(weekFromPeriodKey("2027-W01")).toEqual({ monday: "2027-01-04", sunday: "2027-01-10" });
  });

  it("rejects malformed keys", () => {
    expect(weekFromPeriodKey("2026-36")).toBeNull();
    expect(weekFromPeriodKey("2026-W99")).toBeNull();
  });
});

describe("zonedTimeToUtc", () => {
  it("converts Moscow wall-clock time (UTC+3, no DST)", () => {
    expect(zonedTimeToUtc("2026-09-06", 20, 0, "Europe/Moscow").toISOString()).toBe("2026-09-06T17:00:00.000Z");
    expect(zonedTimeToUtc("2026-01-04", 0, 30, "Europe/Moscow").toISOString()).toBe("2026-01-03T21:30:00.000Z");
  });

  it("handles DST zones", () => {
    expect(zonedTimeToUtc("2026-07-01", 12, 0, "Europe/Berlin").toISOString()).toBe("2026-07-01T10:00:00.000Z");
    expect(zonedTimeToUtc("2026-01-01", 12, 0, "Europe/Berlin").toISOString()).toBe("2026-01-01T11:00:00.000Z");
  });
});
