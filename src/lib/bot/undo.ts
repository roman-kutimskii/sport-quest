import { prisma, TelegramLinkStatus, type TelegramLink } from "@/lib/db";

/**
 * Undo everything the bot created from one group message: deletes the reports linked to it and
 * marks the link UNDONE. Used by the «🗑 Отменить» button and by the admin page. The caller is
 * responsible for editing the bot's reply in Telegram (the worker does it directly, the web app
 * enqueues an Outbox TEXT row with `editMessageId`).
 */
export async function undoLink(linkId: string): Promise<{ link: TelegramLink; deleted: number; userId: string | null } | null> {
  const link = await prisma.telegramLink.findUnique({ where: { id: linkId } });
  if (!link) return null;
  const [del, updated] = await prisma.$transaction([
    prisma.report.deleteMany({ where: { linkId } }),
    prisma.telegramLink.update({ where: { id: linkId }, data: { status: TelegramLinkStatus.UNDONE, processedAt: new Date() } }),
  ]);
  return { link: updated, deleted: del.count, userId: link.userId };
}

/** Deep link to a message in a supergroup: t.me/c/<internal id>/<message id>. */
export function messageLink(chatId: string, messageId: number, threadId?: number | null): string | null {
  const m = /^-100(\d+)$/.exec(chatId);
  if (!m) return null;
  return threadId ? `https://t.me/c/${m[1]}/${threadId}/${messageId}` : `https://t.me/c/${m[1]}/${messageId}`;
}
