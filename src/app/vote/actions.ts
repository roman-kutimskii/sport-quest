"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getActiveQuest } from "@/lib/quest";

export type VoteState = { error?: string; ok?: boolean } | undefined;

export async function castVote(_prev: VoteState, formData: FormData): Promise<VoteState> {
  const user = await requireUser();
  const quest = await getActiveQuest();
  if (!quest.votingOpen) return { error: "Голосование закрыто" };

  const candidateId = String(formData.get("candidateId") ?? "");
  if (!candidateId) return { error: "Выбери участника" };
  if (candidateId === user.id) return { error: "За себя голосовать нельзя 😉" };
  const candidate = await prisma.user.findUnique({ where: { id: candidateId } });
  if (!candidate || !candidate.isActive) return { error: "Такого участника нет" };

  await prisma.ambassadorVote.upsert({
    where: { questId_voterId: { questId: quest.id, voterId: user.id } },
    create: { questId: quest.id, voterId: user.id, candidateId },
    update: { candidateId, createdAt: new Date() },
  });

  revalidatePath("/vote");
  revalidatePath("/admin");
  revalidatePath("/results");
  return { ok: true };
}
