import { prisma } from "@/lib/db";

/**
 * Merge a duplicate participant (typically auto-created by the bot for someone without a
 * @username who had not signed in yet) into the real account: moves reports, adjustments,
 * votes, bot links and Telegram identifiers, then deactivates the duplicate.
 */
export async function mergeUsers(fromId: string, intoId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (fromId === intoId) return { ok: false, error: "Это один и тот же участник" };
  const [from, into] = await Promise.all([
    prisma.user.findUnique({ where: { id: fromId } }),
    prisma.user.findUnique({ where: { id: intoId } }),
  ]);
  if (!from || !into) return { ok: false, error: "Участник не найден" };

  await prisma.$transaction(async (tx) => {
    await tx.report.updateMany({ where: { userId: fromId }, data: { userId: intoId } });
    await tx.report.updateMany({ where: { reviewedById: fromId }, data: { reviewedById: intoId } });
    await tx.adjustment.updateMany({ where: { userId: fromId }, data: { userId: intoId } });
    await tx.telegramLink.updateMany({ where: { userId: fromId }, data: { userId: intoId } });
    await tx.nominationResult.updateMany({ where: { userId: fromId }, data: { userId: intoId } });
    // Votes: keep the target's own vote if both voted; move candidate votes, drop self-votes.
    const targetVoted = await tx.ambassadorVote.findMany({ where: { voterId: intoId }, select: { questId: true } });
    const votedQuests = new Set(targetVoted.map((v) => v.questId));
    const fromVotes = await tx.ambassadorVote.findMany({ where: { voterId: fromId } });
    for (const v of fromVotes) {
      if (votedQuests.has(v.questId) || v.candidateId === intoId) await tx.ambassadorVote.delete({ where: { id: v.id } });
      else await tx.ambassadorVote.update({ where: { id: v.id }, data: { voterId: intoId } });
    }
    await tx.ambassadorVote.deleteMany({ where: { candidateId: fromId, voterId: intoId } });
    await tx.ambassadorVote.updateMany({ where: { candidateId: fromId }, data: { candidateId: intoId } });

    // Telegram identifiers are unique: free them on the duplicate before copying onto the target.
    const ids = { telegramId: from.telegramId, telegramUserId: from.telegramUserId, telegramHandle: from.telegramHandle };
    await tx.user.update({
      where: { id: fromId },
      data: { telegramId: null, telegramUserId: null, isActive: false, isAdmin: false, name: `${from.name} (объединён)`.slice(0, 80) },
    });
    await tx.user.update({
      where: { id: intoId },
      data: {
        telegramId: into.telegramId ?? ids.telegramId,
        telegramUserId: into.telegramUserId ?? ids.telegramUserId,
        telegramHandle: into.telegramHandle ?? ids.telegramHandle,
      },
    });
  });
  return { ok: true };
}
