import { describe, expect, it } from "vitest";
import {
  fmtDateShort,
  fmtSteps,
  pluralRu,
  renderAnnouncement,
  renderHelp,
  renderMe,
  renderPrivateOnlyGroup,
  renderReplyAsk,
  renderReplyDateError,
  renderReplySaved,
  renderReplyUndone,
  renderTop,
} from "./text";

describe("pluralRu", () => {
  const d = (n: number) => pluralRu(n, "день", "дня", "дней");
  it("follows Russian rules", () => {
    expect(d(1)).toBe("1 день");
    expect(d(2)).toBe("2 дня");
    expect(d(4)).toBe("4 дня");
    expect(d(5)).toBe("5 дней");
    expect(d(11)).toBe("11 дней");
    expect(d(12)).toBe("12 дней");
    expect(d(14)).toBe("14 дней");
    expect(d(21)).toBe("21 день");
    expect(d(22)).toBe("22 дня");
    expect(d(111)).toBe("111 дней");
    expect(d(0)).toBe("0 дней");
  });
});

describe("formatting", () => {
  it("fmtSteps groups thousands", () => {
    expect(fmtSteps(12000)).toBe("12 000");
    expect(fmtSteps(999)).toBe("999");
    expect(fmtSteps(1234567)).toBe("1 234 567");
  });
  it("fmtDateShort", () => {
    expect(fmtDateShort("2026-09-04")).toBe("4 сен");
    expect(fmtDateShort("2026-10-31")).toBe("31 окт");
  });
});

describe("renderReplySaved", () => {
  it("renders the spec example", () => {
    const s = renderReplySaved({
      activityTitle: "Бег",
      activityEmoji: "🏃",
      date: "2026-09-04",
      dayAlreadyActive: false,
      total: 12,
      streak: 4,
      bingoOffer: { emoji: "🍂", title: "Листопадный фитнес" },
      videoTooLarge: false,
    });
    expect(s.split("\n")[0]).toBe("🏃 Записал: бег, 4 сен · +1 🎃 · стрик 4 🔥");
    expect(s.split("\n")[1]).toBe("🍂 Похоже на бинго «Листопадный фитнес» — засчитать?");
  });

  it("mentions steps, saved bingo, needs-photo and video notes", () => {
    const s = renderReplySaved({
      activityTitle: "Прогулка",
      activityEmoji: "🚶",
      date: "2026-09-04",
      dayAlreadyActive: false,
      total: 5,
      streak: 1,
      steps: 12000,
      bingoSaved: { emoji: "🍂", title: "Листопадный фитнес" },
      bingoNeedsPhoto: { title: "Лифтофобия" },
      videoTooLarge: true,
    });
    expect(s).toContain("· 12 000 шагов");
    expect(s).toContain("🍂 Бинго «Листопадный фитнес» +3 🎃");
    expect(s).toContain("🎯 Бинго «Лифтофобия» нужно с фото — прикрепи его на сайте");
    expect(s).toContain("🎬 Видео больше 20 МБ — прикрепи его на сайте, если нужно");
  });

  it("day already active", () => {
    const s = renderReplySaved({
      activityTitle: "Бег",
      activityEmoji: "🏃",
      date: "2026-09-04",
      dayAlreadyActive: true,
      total: 12,
      streak: 4,
      steps: 8000,
      videoTooLarge: false,
    });
    expect(s).toContain("🏃 День 4 сен уже засчитан ✅");
    expect(s).toContain("8 000 шагов");
    expect(s).not.toContain("+1 🎃");
  });

  it("steps-only report", () => {
    const s = renderReplySaved({ date: "2026-09-04", dayAlreadyActive: false, total: 3, streak: 0, steps: 12000, videoTooLarge: false });
    expect(s).toContain("🚶 Записал: 12 000 шагов, 4 сен");
    expect(s).not.toContain("стрик");
  });
});

describe("small replies", () => {
  it("static texts", () => {
    expect(renderReplyAsk()).toBe("Это отчёт о тренировке?");
    expect(renderReplyUndone()).toBe("Отменено");
    expect(renderPrivateOnlyGroup()).toContain("Я работаю только в группе квеста");
    expect(renderReplyDateError("future")).toContain("будущем");
    expect(renderReplyDateError("outside")).toContain("вне квеста");
  });
});

describe("renderAnnouncement", () => {
  it("activity line", () => {
    const s = renderAnnouncement({
      name: "Маша",
      items: [{ kind: "ACTIVITY", activityTitle: "Йога", activityEmoji: "🧘" }],
      date: "2026-09-03",
      total: 12,
      streak: 3,
    });
    expect(s).toBe("🧘 Маша: йога за 3 сен · 12 🎃 · стрик 3 🔥");
  });
  it("bingo line with progress", () => {
    const s = renderAnnouncement({
      name: "Петя",
      items: [{ kind: "BINGO", bingoTitle: "Лифтофобия", bingoEmoji: "🪜" }],
      date: "2026-09-03",
      total: 20,
      streak: 0,
      bingoDone: 5,
    });
    expect(s).toBe("🪜 Петя: бинго «Лифтофобия» (5/9) за 3 сен · 20 🎃");
  });
  it("merges activity + bingo + steps into one line", () => {
    const s = renderAnnouncement({
      name: "Петя",
      items: [
        { kind: "ACTIVITY", activityTitle: "Бег", activityEmoji: "🏃", steps: 11000 },
        { kind: "BINGO", bingoTitle: "Ранняя пташка", bingoEmoji: "🌅" },
      ],
      date: "2026-09-03",
      total: 20,
      streak: 2,
      bingoDone: 1,
    });
    expect(s).toBe("🏃 Петя: бег + бинго «Ранняя пташка» (1/9) за 3 сен · 11 000 шагов · 20 🎃 · стрик 2 🔥");
  });
  it("steps-only", () => {
    const s = renderAnnouncement({ name: "Оля", items: [{ kind: "STEPS", steps: 12000 }], date: "2026-09-03", total: 4, streak: 0 });
    expect(s).toBe("🚶 Оля: 12 000 шагов за 3 сен · 4 🎃");
  });
});

describe("renderTop / renderMe / renderHelp", () => {
  it("top-10 numbered", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ rank: i + 1, name: `U${i + 1}`, avatarEmoji: "🎃", total: 100 - i, streak: i === 0 ? 3 : 0 }));
    const s = renderTop(rows);
    expect(s).toContain("1. 🎃 U1 — 100 🎃 · стрик 3 🔥");
    expect(s).toContain("2. 🎃 U2 — 99 🎃");
    expect(s).not.toContain("U2 — 99 🎃 ·");
    expect(s).toContain("10. 🎃 U10");
    expect(s).not.toContain("U11");
  });
  it("me", () => {
    const s = renderMe({ name: "Маша", total: 12, streak: 3, bingo: 2, bingoTotal: 9, steps: 45000, rank: 4, activeDays: 7 });
    expect(s).toContain("4 место");
    expect(s).toContain("12 🎃");
    expect(s).toContain("Активных дней: 7");
    expect(s).toContain("стрик 3 🔥");
    expect(s).toContain("2/9");
    expect(s).toContain("45 000");
  });
  it("help mentions commands and site", () => {
    const s = renderHelp("https://example.org");
    expect(s).toContain("/me");
    expect(s).toContain("/top");
    expect(s).toContain("Отменить");
    expect(s).toContain("https://example.org");
    expect(s).not.toContain("\n");
  });
});
