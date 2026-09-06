import { describe, expect, it } from "vitest";
import { collabPartners, parseStoredExtraction, pickActivities, savedActivities } from "./ingest";

const stored = {
  is_report: true, confidence: 0.9, date: null, steps: null, bingo_key: null, bingo_explicit: false, bingo_confidence: 0,
  collab_with: [] as string[], summary_ru: "бег", resolvedDate: "2026-09-05", proofUrls: [], hasMedia: false, videoTooLarge: false, text: "бег", mentions: [],
};

describe("parseStoredExtraction", () => {
  it("upgrades rows written with a single activity_type", () => {
    const e = parseStoredExtraction({ ...stored, activity_type: "run", savedActivityType: "run" });
    expect(e?.activity_types).toEqual(["run"]);
    expect(savedActivities(e!)).toEqual(["run"]);
    expect(parseStoredExtraction({ ...stored, activity_type: null })?.activity_types).toEqual([]);
  });

  it("keeps the array form as is", () => {
    const e = parseStoredExtraction({ ...stored, activity_types: ["run", "yoga"], savedActivityTypes: ["run", "yoga"] });
    expect(savedActivities(e!)).toEqual(["run", "yoga"]);
  });
});

describe("pickActivities", () => {
  const e = { ...stored, activity_types: [] as string[] };
  it("files an activity-less confident report as «other» unless steps or bingo carry it", () => {
    expect(pickActivities(e, false)).toEqual(["other"]);
    expect(pickActivities(e, true)).toEqual([]);
    expect(pickActivities({ ...e, steps: 8000 }, false)).toEqual([]);
    expect(pickActivities({ ...e, activity_types: ["run", "yoga"] }, true)).toEqual(["run", "yoga"]);
  });
});

describe("collabPartners", () => {
  it("returns only mentioned participants listed in collab_with, with a display label", () => {
    const e = parseStoredExtraction({
      ...stored, activity_types: ["run"], collab_with: ["masha", "tg42", "stranger"],
      mentions: [
        { ref: "masha", name: "Маша", participant: true, userId: "u1" },
        { ref: "tg42", name: "Петя", participant: true, userId: "u2" },
        { ref: "stranger", name: "@stranger", participant: false, userId: null },
        { ref: "vasya", name: "Вася", participant: true, userId: "u3" },
      ],
    })!;
    expect(collabPartners(e)).toEqual([{ userId: "u1", label: "@masha" }, { userId: "u2", label: "Петя" }]);
  });
});
