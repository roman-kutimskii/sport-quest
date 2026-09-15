/**
 * «Повторить» on a FAILED bot row (admin page). The web app has neither the LLM key nor the bot
 * token, so it only re-queues the row; the worker runs the normal pipeline on it. `retryRequestedAt`
 * makes that run quiet: the message is acknowledged with a reaction and nothing is posted to the chat.
 */
import { prisma, TelegramLinkStatus } from "@/lib/db";

/**
 * Atomically moves a FAILED link back to RECEIVED. Returns false and changes nothing when the row is
 * no longer FAILED — a double click, a second admin, or a row processed since.
 */
export async function requestRetry(linkId: string, now: Date = new Date()): Promise<boolean> {
  const { count } = await prisma.telegramLink.updateMany({
    where: { id: linkId, status: TelegramLinkStatus.FAILED },
    data: { status: TelegramLinkStatus.RECEIVED, retryRequestedAt: now, error: null, processedAt: null },
  });
  return count === 1;
}
