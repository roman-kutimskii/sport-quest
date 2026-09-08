/**
 * Outbox helpers: idempotent enqueue of TEXT / DIGEST rows (a duplicate dedupeKey is swallowed).
 */
import { prisma, Prisma } from "@/lib/db";

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

async function enqueue(data: Prisma.OutboxCreateInput): Promise<void> {
  try {
    await prisma.outbox.create({ data });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
  }
}

/** Payload: { messageId, emoji }. `emoji: null` clears the reaction. Idempotent on dedupeKey. */
export async function enqueueReaction(
  chatId: string,
  messageId: number,
  emoji: string | null,
  threadId?: number | null,
  dedupeKey?: string,
): Promise<void> {
  await enqueue({ kind: "REACTION", chatId, threadId: threadId ?? null, payload: { messageId, emoji }, dedupeKey: dedupeKey ?? null });
}

/** Payload: { text }. Idempotent on dedupeKey. */
export async function enqueueText(chatId: string, text: string, threadId?: number | null, dedupeKey?: string): Promise<void> {
  await enqueue({ kind: "TEXT", chatId, threadId: threadId ?? null, payload: { text }, dedupeKey: dedupeKey ?? null });
}

/** Payload: { periodKey, manual }. Weekly runs dedupe on `digest:<periodKey>`; manual (/digest) runs never dedupe. */
export async function enqueueDigest(
  periodKey: string,
  chatId: string,
  threadId: number | null,
  opts?: { manual?: boolean },
): Promise<void> {
  const manual = opts?.manual ?? false;
  await enqueue({ kind: "DIGEST", chatId, threadId, payload: { periodKey, manual }, dedupeKey: manual ? null : `digest:${periodKey}` });
}
