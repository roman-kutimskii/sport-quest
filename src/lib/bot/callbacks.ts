/**
 * Inline-button handling (spec §2.1). Runs inline in the receive loop, so nothing slow lives here:
 * answerCallbackQuery clears the spinner as soon as the (cheap) permission check is done.
 */
import { prisma, ReportSource, TelegramLinkStatus, type TelegramLink } from "@/lib/db";
import { createReport } from "@/lib/reports/create";
import { getActiveQuest } from "@/lib/quest";
import { decide } from "./extraction";
import { errorMessage, parseStoredExtraction, renderSavedText, saveFromExtraction, toJson, userScore, type Deps } from "./ingest";
import { buildSavedKeyboard, parseCallback } from "./keyboards";
import type { TgCallbackQuery } from "./telegram-api";
import { renderReplyUndone } from "./text";
import { undoLink } from "./undo";

const log = (msg: string) => console.log(`[bot] ${new Date().toISOString()} callback: ${msg}`);

async function isAdmin(telegramUserId: number): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { telegramUserId: String(telegramUserId) }, select: { isAdmin: true } });
  return u?.isAdmin ?? false;
}

export async function handleCallback(deps: Deps, cq: TgCallbackQuery): Promise<void> {
  const { api } = deps;
  try {
    const parsed = parseCallback(cq.data);
    if (!parsed) {
      await api.answerCallbackQuery(cq.id);
      return;
    }
    const link = await prisma.telegramLink.findUnique({ where: { id: parsed.linkId } });
    if (!link) {
      await api.answerCallbackQuery(cq.id, "Запись не найдена", true);
      return;
    }
    const allowed = String(cq.from.id) === link.fromUserId || (await isAdmin(cq.from.id));
    if (!allowed) {
      await api.answerCallbackQuery(cq.id, "Только автор или админ", true);
      return;
    }
    await api.answerCallbackQuery(cq.id);
    log(`${parsed.op}:${link.id} by ${cq.from.id} (link status ${link.status})`);

    switch (parsed.op) {
      case "u":
        return await onUndo(deps, link);
      case "b":
        return await onBingo(deps, link);
      case "y":
        return await onYes(deps, link);
      case "n":
        return await onNo(deps, link);
    }
  } catch (e) {
    console.error(`[bot] ${new Date().toISOString()} callback ${cq.data ?? "?"} failed: ${errorMessage(e)}`);
  }
}

async function onUndo(deps: Deps, link: TelegramLink): Promise<void> {
  if (link.status !== TelegramLinkStatus.SAVED) return;
  await undoLink(link.id);
  if (link.replyMessageId) {
    await deps.api.editMessageText({ chatId: link.chatId, messageId: link.replyMessageId, text: renderReplyUndone(), replyMarkup: null });
  }
  log(`${link.id} undone`);
}

async function onBingo(deps: Deps, link: TelegramLink): Promise<void> {
  if (link.status !== TelegramLinkStatus.SAVED || !link.userId || !link.replyMessageId) return;
  const stored = parseStoredExtraction(link.extraction);
  if (!stored || !stored.resolvedDate || !stored.bingo_key || stored.bingoSaved) return;
  const quest = await getActiveQuest();
  const userId = link.userId;

  const res = await createReport({
    userId, quest, date: stored.resolvedDate, bingoKey: stored.bingo_key, comment: stored.text, proofUrls: stored.proofUrls,
    source: ReportSource.TELEGRAM, linkId: link.id,
  });
  const decision = decide(stored, { hasMedia: stored.hasMedia });
  const { total, streak } = await userScore(quest, userId);
  const next = { ...stored, bingoSaved: res.ok };
  let text = renderSavedText(stored, {
    activityType: stored.savedActivityType ?? null, total, streak, dayAlreadyActive: stored.dayAlreadyActive ?? false,
    bingoSaved: res.ok ? stored.bingo_key : null, bingoOffer: null, bingoNeedsPhoto: decision.bingoNeedsPhotoNote,
  });
  if (!res.ok) text += `\n⚠️ Бинго не засчитано: ${res.error}`;
  await deps.api.editMessageText({
    chatId: link.chatId, messageId: link.replyMessageId, text,
    replyMarkup: buildSavedKeyboard({ linkId: link.id, userId, publicUrl: deps.cfg.publicUrl, offerBingo: false }),
  });
  await prisma.telegramLink.update({ where: { id: link.id }, data: { extraction: toJson(next) } });
  log(`${link.id} bingo ${stored.bingo_key}: ${res.ok ? "saved" : res.error}`);
}

async function onYes(deps: Deps, link: TelegramLink): Promise<void> {
  if (link.status !== TelegramLinkStatus.ASKED) return;
  const stored = parseStoredExtraction(link.extraction);
  if (!stored) throw new Error("no stored extraction");
  await saveFromExtraction(deps, link, stored, { editMessageId: link.replyMessageId });
}

async function onNo(deps: Deps, link: TelegramLink): Promise<void> {
  if (link.status !== TelegramLinkStatus.ASKED) return;
  await prisma.telegramLink.update({
    where: { id: link.id },
    data: { status: TelegramLinkStatus.SKIPPED, error: "declined", processedAt: new Date() },
  });
  if (link.replyMessageId) await deps.api.deleteMessage(link.chatId, link.replyMessageId).catch(() => undefined);
  log(`${link.id} declined`);
}
