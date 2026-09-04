import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getActiveQuest } from "@/lib/quest";
import { VoteForm } from "./vote-form";

export const dynamic = "force-dynamic";

export default async function VotePage() {
  const [user, quest] = await Promise.all([requireUser(), getActiveQuest()]);

  if (!quest.votingOpen) {
    return (
      <div className="card mx-auto max-w-lg p-8 text-center">
        <div className="text-5xl">📸</div>
        <h1 className="mt-3 text-2xl font-bold">Голосование закрыто</h1>
        <p className="mt-2 text-fgm">Организатор откроет выбор «Амбассадора Осени» ближе к финалу.</p>
        <Link href="/" className="btn-primary mt-6">К таблице</Link>
      </div>
    );
  }

  const [candidates, myVote] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true, id: { not: user.id } },
      select: { id: true, name: true, avatarEmoji: true },
      orderBy: { name: "asc" },
    }),
    prisma.ambassadorVote.findUnique({ where: { questId_voterId: { questId: quest.id, voterId: user.id } } }),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="text-center">
        <div className="text-5xl">📸</div>
        <h1 className="mt-3 text-2xl font-bold sm:text-3xl">Выбираем «Амбассадора Осени»</h1>
        <p className="mt-2 text-fgm">Чьи фото и видео этой осенью были самыми атмосферными? Один голос, за себя нельзя. Пока голосование открыто, выбор можно поменять.</p>
      </header>
      <section className="card p-5">
        {candidates.length === 0 ? (
          <p className="text-center text-fgm">Кроме тебя пока никого нет 🙃</p>
        ) : (
          <VoteForm candidates={candidates} current={myVote?.candidateId ?? null} />
        )}
      </section>
    </div>
  );
}
