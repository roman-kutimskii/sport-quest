/**
 * Outbox helpers: pure grouping of REPORT_CREATED rows into announcements, and idempotent enqueue
 * of TEXT / DIGEST rows (a duplicate dedupeKey is swallowed).
 */
import { prisma, Prisma } from "@/lib/db";

export type AnnouncementRow = { id: string; createdAt: Date; payload: { userId: string; reportIds: string[] } };
export type AnnouncementGroup = { rowIds: string[]; userId: string; reportIds: string[] };

/**
 * Rows are sorted by createdAt; a row joins the current group of the same user when it was created
 * within `mergeSeconds` of that group's first row. Groups keep the order of their first row.
 */
export function groupAnnouncements(rows: AnnouncementRow[], mergeSeconds: number): AnnouncementGroup[] {
  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const groups: (AnnouncementGroup & { startMs: number })[] = [];
  const open = new Map<string, AnnouncementGroup & { startMs: number }>();
  for (const row of sorted) {
    const ms = row.createdAt.getTime();
    const g = open.get(row.payload.userId);
    if (g && ms - g.startMs <= mergeSeconds * 1000) {
      g.rowIds.push(row.id);
      g.reportIds.push(...row.payload.reportIds);
      continue;
    }
    const ng = { rowIds: [row.id], userId: row.payload.userId, reportIds: [...row.payload.reportIds], startMs: ms };
    groups.push(ng);
    open.set(row.payload.userId, ng);
  }
  return groups.map(({ rowIds, userId, reportIds }) => ({ rowIds, userId, reportIds }));
}

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
