/** Inline keyboards and callback_data encoding for the bot's replies. Pure. */
import type { InlineKeyboard } from "./telegram-api";

/** b = «Да, бинго», u = «Отменить», y / n = answer to «Это отчёт?». */
export type CallbackOp = "b" | "u" | "y" | "n";
const OPS: readonly CallbackOp[] = ["b", "u", "y", "n"];

/** `<op>:<linkId>` — well under Telegram's 64-byte callback_data limit with cuid ids. */
export function formatCallback(op: CallbackOp, linkId: string): string {
  return `${op}:${linkId}`;
}

export function parseCallback(data: string | undefined | null): { op: CallbackOp; linkId: string } | null {
  if (!data) return null;
  const i = data.indexOf(":");
  if (i <= 0) return null;
  const op = data.slice(0, i);
  const linkId = data.slice(i + 1).trim();
  if (!OPS.includes(op as CallbackOp) || !linkId) return null;
  return { op: op as CallbackOp, linkId };
}

/** Buttons under a «Записал…» reply: optional bingo offer, then «Исправить на сайте» + «Отменить». */
export function buildSavedKeyboard(p: { linkId: string; userId: string; publicUrl: string; offerBingo: boolean }): InlineKeyboard {
  const rows: InlineKeyboard["inline_keyboard"] = [];
  if (p.offerBingo) rows.push([{ text: "🍂 Да, бинго", callback_data: formatCallback("b", p.linkId) }]);
  rows.push([
    { text: "✏️ Исправить на сайте", url: `${p.publicUrl.replace(/\/+$/, "")}/u/${p.userId}` },
    { text: "🗑 Отменить", callback_data: formatCallback("u", p.linkId) },
  ]);
  return { inline_keyboard: rows };
}

/** Buttons under «Это отчёт о тренировке?». */
export function buildAskKeyboard(linkId: string): InlineKeyboard {
  return {
    inline_keyboard: [[
      { text: "✅ Да", callback_data: formatCallback("y", linkId) },
      { text: "❌ Нет", callback_data: formatCallback("n", linkId) },
    ]],
  };
}
