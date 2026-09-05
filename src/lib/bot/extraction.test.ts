import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { LlmClient } from "./llm";
import { buildSystemPrompt, coerceExtraction, decide, extractReport, parseJsonLoose, resolveDate, type Extraction, type PromptContext } from "./extraction";

const base: Extraction = {
  is_report: true, confidence: 0.9, date: null, activity_type: "run", steps: null,
  bingo_key: null, bingo_explicit: false, bingo_confidence: 0, summary_ru: "бег",
};

describe("coerceExtraction", () => {
  it("nulls unknown activity types and bingo keys outside the open set", () => {
    const e = coerceExtraction({ ...base, activity_type: "skiing", bingo_key: "stairs", bingo_explicit: true, bingo_confidence: 0.9 }, ["leaves"]);
    expect(e.activity_type).toBeNull();
    expect(e.bingo_key).toBeNull();
    expect(e.bingo_explicit).toBe(false);
    expect(e.bingo_confidence).toBe(0);
  });

  it("keeps valid enums (case-insensitive) and numeric-string steps", () => {
    const e = coerceExtraction({ ...base, activity_type: "Gym", steps: "12 000", bingo_key: "stairs", bingo_explicit: true, bingo_confidence: 0.8 }, ["stairs"]);
    expect(e.activity_type).toBe("gym");
    expect(e.steps).toBe(12000);
    expect(e.bingo_key).toBe("stairs");
    expect(e.bingo_explicit).toBe(true);
  });

  it("throws ZodError on structural failure", () => {
    expect(() => coerceExtraction({ is_report: "yes" }, [])).toThrow(z.ZodError);
    expect(() => coerceExtraction({ ...base, date: "04.09.2026" }, [])).toThrow(z.ZodError);
  });
});

describe("parseJsonLoose", () => {
  it("strips fences and surrounding prose", () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('Вот ответ: {"a":{"b":2}} готово')).toEqual({ a: { b: 2 } });
    expect(() => parseJsonLoose("nothing here")).toThrow();
  });
});

describe("decide", () => {
  it("bands by confidence", () => {
    expect(decide({ ...base, confidence: 0.75 }, { hasMedia: false }).action).toBe("save");
    expect(decide({ ...base, confidence: 0.74 }, { hasMedia: false }).action).toBe("ask");
    expect(decide({ ...base, confidence: 0.45 }, { hasMedia: false }).action).toBe("ask");
    expect(decide({ ...base, confidence: 0.44 }, { hasMedia: false }).action).toBe("skip");
    expect(decide({ ...base, is_report: false, confidence: 0.99 }, { hasMedia: true }).action).toBe("skip");
  });

  it("steps-only message without activity is still a report", () => {
    expect(decide({ ...base, activity_type: null, steps: 12000 }, { hasMedia: false }).action).toBe("save");
  });

  it("bingo save / offer / none", () => {
    const b = { ...base, bingo_key: "stairs" };
    expect(decide({ ...b, bingo_explicit: true, bingo_confidence: 0.8 }, { hasMedia: true }).bingo).toBe("save");
    expect(decide({ ...b, bingo_explicit: true, bingo_confidence: 0.6 }, { hasMedia: true }).bingo).toBe("offer");
    expect(decide({ ...b, bingo_explicit: false, bingo_confidence: 0.9 }, { hasMedia: true }).bingo).toBe("offer");
    expect(decide({ ...b, bingo_explicit: false, bingo_confidence: 0.4 }, { hasMedia: true }).bingo).toBe("none");
    expect(decide({ ...base, bingo_confidence: 0.9 }, { hasMedia: true }).bingo).toBe("none");
  });

  it("flags bingo without a photo", () => {
    const d = decide({ ...base, bingo_key: "stairs", bingo_explicit: true, bingo_confidence: 0.9 }, { hasMedia: false });
    expect(d.bingo).toBe("none");
    expect(d.bingoNeedsPhotoNote).toBe(true);
    expect(decide({ ...base, bingo_key: "stairs", bingo_confidence: 0.3 }, { hasMedia: false }).bingoNeedsPhotoNote).toBe(false);
    expect(decide({ ...base, bingo_key: "stairs", bingo_confidence: 0.9 }, { hasMedia: true }).bingoNeedsPhotoNote).toBe(false);
  });
});

describe("resolveDate", () => {
  const q = ["2026-09-01", "2026-10-31", "2026-09-05"] as const;
  it("null date → message date", () => expect(resolveDate(base, "2026-09-04", ...q)).toEqual({ date: "2026-09-04" }));
  it("explicit date wins", () => expect(resolveDate({ ...base, date: "2026-09-02" }, "2026-09-04", ...q)).toEqual({ date: "2026-09-02" }));
  it("future", () => expect(resolveDate({ ...base, date: "2026-09-06" }, "2026-09-04", ...q)).toEqual({ error: "future" }));
  it("outside quest", () => {
    expect(resolveDate({ ...base, date: "2026-08-31" }, "2026-09-04", ...q)).toEqual({ error: "outside" });
    expect(resolveDate(base, "2026-08-31", ...q)).toEqual({ error: "outside" });
  });
});

const ctx: PromptContext = {
  todayDate: "2026-09-05", messageDate: "2026-09-04", messageTime: "21:15", questStart: "2026-09-01", questEnd: "2026-10-31",
  openBingoKeys: ["stairs", "leaves"], senderName: "Маша", text: "пробежала 5 км", mediaKinds: [], imageCount: 0, forwarded: false,
};

describe("buildSystemPrompt", () => {
  it("lists activities, marks closed bingo tasks and includes dates", () => {
    const p = buildSystemPrompt(ctx);
    expect(p).toContain('"run" — Бег');
    expect(p).toContain("2026-09-04");
    expect(p).toContain("21:15");
    expect(p).toMatch(/"early".*уже закрыто/);
    expect(p).not.toMatch(/"stairs".*уже закрыто/);
    expect(p).toContain('"stairs", "leaves"');
  });
});

describe("extractReport", () => {
  it("retries once with the validation error appended", async () => {
    const calls: { user: unknown[] }[] = [];
    const llm: LlmClient = {
      async complete(input) {
        calls.push({ user: input.user });
        return { text: calls.length === 1 ? '{"is_report": "maybe"}' : '```json\n{"is_report":true,"confidence":0.9,"date":null,"activity_type":"run","steps":null,"bingo_key":null,"bingo_explicit":false,"bingo_confidence":0,"summary_ru":"бег 5 км"}\n```' };
      },
    };
    const { extraction } = await extractReport(llm, ctx, []);
    expect(extraction.activity_type).toBe("run");
    expect(calls).toHaveLength(2);
    const last = calls[1].user[calls[1].user.length - 1] as { type: string; text: string };
    expect(last.type).toBe("text");
    expect(last.text).toMatch(/is_report/);
  });

  it("throws after two bad answers", async () => {
    const llm: LlmClient = { async complete() { return { text: "not json" }; } };
    await expect(extractReport(llm, ctx, [])).rejects.toThrow(/twice/);
  });
});
