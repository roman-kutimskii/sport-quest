/** saveFromExtraction: idempotency per link and the quiet (admin retry) acknowledgement. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TelegramLink } from "@/lib/db";

type FakeReport = { linkId: string; activityTypes: string[]; bingoKey: string | null };
const reports: FakeReport[] = [];
const linkUpdate = vi.fn(async () => ({}));

vi.mock("@/lib/db", () => ({
  Prisma: {},
  ReportKind: { ACTIVITY: "ACTIVITY", BINGO: "BINGO", STEPS: "STEPS" },
  ReportSource: { WEB: "WEB", TELEGRAM: "TELEGRAM" },
  ReportStatus: { PENDING: "PENDING", APPROVED: "APPROVED", REJECTED: "REJECTED" },
  TelegramLinkStatus: { RECEIVED: "RECEIVED", SKIPPED: "SKIPPED", ASKED: "ASKED", SAVED: "SAVED", UNDONE: "UNDONE", FAILED: "FAILED" },
  prisma: {
    report: { findMany: vi.fn(async ({ where }: { where: { linkId: string } }) => reports.filter((r) => r.linkId === where.linkId)) },
    telegramLink: { update: linkUpdate },
  },
}));

const createReport = vi.fn(async (input: { linkId: string; activityTypes: string[]; bingoKey: string | null }) => {
  const r = { linkId: input.linkId, activityTypes: input.activityTypes, bingoKey: input.bingoKey };
  reports.push(r);
  return { ok: true as const, created: [r] };
});
vi.mock("@/lib/reports/create", () => ({ createReport }));
vi.mock("@/lib/quest", () => ({
  getActiveQuest: vi.fn(async () => ({ id: "q1" })),
  getUserBreakdown: vi.fn(async () => null),
  questDates: vi.fn(() => ({ start: "2026-09-01", end: "2026-10-31", today: "2026-09-15" })),
}));

const { parseStoredExtraction, saveFromExtraction } = await import("./ingest");

const api = {
  setMessageReaction: vi.fn(async () => true),
  sendMessage: vi.fn(async () => ({ message_id: 99 })),
  editMessageText: vi.fn(async () => ({})),
};
const deps = { api, llm: {}, limiter: {}, cfg: { publicUrl: "https://example.test", mode: "live" } } as unknown as Parameters<typeof saveFromExtraction>[0];

const link = { id: "L1", chatId: "-1001", messageId: 5, threadId: null, userId: "U1", replyMessageId: null } as unknown as TelegramLink;

const stored = parseStoredExtraction({
  is_report: true, confidence: 0.95, date: null, activity_types: ["run"], steps: null,
  bingo_key: null, bingo_explicit: false, bingo_confidence: 0, summary_ru: "бег",
  resolvedDate: "2026-09-13", proofUrls: ["/uploads/a.jpg"], hasMedia: true, videoTooLarge: false, text: "Погодите, я только села", mentions: [],
})!;

describe("saveFromExtraction", () => {
  beforeEach(() => {
    reports.length = 0;
    vi.clearAllMocks();
  });

  it("files a message only once, however often it is saved", async () => {
    await saveFromExtraction(deps, link, stored, { quiet: true });
    await saveFromExtraction(deps, link, stored, { quiet: true });
    await saveFromExtraction(deps, link, stored);
    expect(createReport).toHaveBeenCalledTimes(1);
    expect(reports).toHaveLength(1);
    expect(linkUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SAVED", error: null }) }));
  });

  it("marks a link that already has reports SAVED without creating more", async () => {
    reports.push({ linkId: "L1", activityTypes: ["run"], bingoKey: null });
    const next = await saveFromExtraction(deps, link, stored, { quiet: true });
    expect(createReport).not.toHaveBeenCalled();
    expect(next.savedActivityTypes).toEqual(["run"]);
    expect(api.setMessageReaction).toHaveBeenCalledWith({ chatId: "-1001", messageId: 5, emoji: "🎃" });
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("a quiet save reacts instead of replying, even when a reply would carry a note", async () => {
    await saveFromExtraction(deps, link, { ...stored, videoTooLarge: true }, { quiet: true });
    expect(api.setMessageReaction).toHaveBeenCalledWith({ chatId: "-1001", messageId: 5, emoji: "🎃" });
    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(api.editMessageText).not.toHaveBeenCalled();
  });

  it("a normal save still replies when there is something to explain", async () => {
    await saveFromExtraction(deps, link, { ...stored, videoTooLarge: true });
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(api.setMessageReaction).not.toHaveBeenCalled();
  });
});
