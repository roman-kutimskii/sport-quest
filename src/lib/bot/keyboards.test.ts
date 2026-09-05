import { describe, expect, it } from "vitest";
import { buildAskKeyboard, buildSavedKeyboard, formatCallback, parseCallback } from "./keyboards";

describe("callback data", () => {
  it("round-trips every op", () => {
    for (const op of ["b", "u", "y", "n"] as const) {
      expect(parseCallback(formatCallback(op, "clx123"))).toEqual({ op, linkId: "clx123" });
    }
  });

  it("stays within Telegram's 64-byte limit for cuid ids", () => {
    expect(Buffer.byteLength(formatCallback("u", "cmf5x9k2a0000abcdefghijkl"))).toBeLessThanOrEqual(64);
  });

  it("rejects malformed data", () => {
    expect(parseCallback(undefined)).toBeNull();
    expect(parseCallback("")).toBeNull();
    expect(parseCallback("x:abc")).toBeNull();
    expect(parseCallback("u:")).toBeNull();
    expect(parseCallback(":abc")).toBeNull();
    expect(parseCallback("nocolon")).toBeNull();
  });
});

describe("buildSavedKeyboard", () => {
  it("offers bingo on its own row above fix/undo", () => {
    const kb = buildSavedKeyboard({ linkId: "L1", userId: "U1", publicUrl: "https://tl-sport.ru/", offerBingo: true });
    expect(kb.inline_keyboard).toEqual([
      [{ text: "🍂 Да, бинго", callback_data: "b:L1" }],
      [
        { text: "✏️ Исправить на сайте", url: "https://tl-sport.ru/u/U1" },
        { text: "🗑 Отменить", callback_data: "u:L1" },
      ],
    ]);
  });

  it("omits the bingo row when there is nothing to offer", () => {
    const kb = buildSavedKeyboard({ linkId: "L1", userId: "U1", publicUrl: "https://tl-sport.ru", offerBingo: false });
    expect(kb.inline_keyboard).toHaveLength(1);
    expect(kb.inline_keyboard[0].map((b) => b.callback_data ?? b.url)).toEqual(["https://tl-sport.ru/u/U1", "u:L1"]);
  });
});

describe("buildAskKeyboard", () => {
  it("has yes/no on one row", () => {
    expect(buildAskKeyboard("L9").inline_keyboard).toEqual([[
      { text: "✅ Да", callback_data: "y:L9" },
      { text: "❌ Нет", callback_data: "n:L9" },
    ]]);
  });
});
