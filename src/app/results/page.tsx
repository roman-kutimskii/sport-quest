import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ambassadorWinner, computeNominations, getActiveQuest, getAmbassadorTally, getLeaderboard, questDates } from "@/lib/quest";
import { NOMINATIONS } from "@/lib/nominations";
import { daysBetween, formatRuDate } from "@/lib/scoring/dates";
import { Pumpkins } from "@/components/pumpkins";

export const dynamic = "force-dynamic";

export default async function ResultsPage() {
  const [viewer, quest] = await Promise.all([getCurrentUser(), getActiveQuest()]);
  const { end, today } = questDates(quest);
  const visible = quest.resultsPublished || today > end || viewer?.isAdmin;
  if (!visible) {
    return (
      <div className="card mx-auto max-w-lg p-8 text-center">
        <div className="text-5xl">🎁</div>
        <h1 className="mt-3 text-2xl font-bold">Итоги — {formatRuDate(end)}</h1>
        <p className="mt-2 text-fgm">Осталось {daysBetween(today, end)} дней. Продолжаем фармить тыковки!</p>
        <Link href="/" className="btn-primary mt-6">К таблице</Link>
      </div>
    );
  }
  const [rows, tally, manual] = await Promise.all([
    getLeaderboard(quest),
    getAmbassadorTally(quest),
    prisma.nominationResult.findMany({ where: { questId: quest.id } }),
  ]);
  const auto = computeNominations(rows);
  const ambassador = ambassadorWinner(tally);
  const byId = (id: string) => rows.find((r) => r.user.id === id)?.user;
  const winners = NOMINATIONS.map((n) => {
    const m = manual.find((x) => x.key === n.key);
    const user = m
      ? byId(m.userId)
      : n.key === "pumpkinLord" ? auto.pumpkinLord?.user
      : n.key === "frodo" ? auto.frodo?.user
      : n.key === "bingoMaster" ? auto.bingoMaster?.row.user
      : n.key === "ambassador" ? ambassador ?? undefined
      : undefined;
    return { ...n, user, manual: !!m };
  });
  const totalVotes = tally.reduce((s, t) => s + t.votes, 0);

  return (
    <div className="space-y-6">
      <header className="text-center">
        <h1 className="text-3xl font-bold">🎁 Итоги операции «Анти-плед»</h1>
        {!quest.resultsPublished && <p className="mt-1 text-sm text-fgm">Предпросмотр для организатора — итоги ещё не опубликованы.</p>}
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        {winners.map((w) => (
          <div key={w.key} className="card p-6 text-center">
            <div className="text-5xl">{w.emoji}</div>
            <h2 className="mt-2 text-lg font-bold">«{w.title}»</h2>
            <p className="text-xs text-fgm">{w.subtitle}</p>
            <div className="mt-4 text-2xl font-bold">{w.user ? `${w.user.avatarEmoji} ${w.user.name}` : "—"}</div>
            {w.key === "ambassador" && !w.manual && totalVotes > 0 && (
              <p className="mt-1 text-xs text-fgm">{tally[0].votes} из {totalVotes} голосов</p>
            )}
          </div>
        ))}
      </div>
      <section className="card overflow-hidden">
        <h2 className="border-b border-line px-5 py-3 font-bold">Финальная таблица</h2>
        <ol className="divide-y divide-line text-sm">
          {rows.map((r) => (
            <li key={r.user.id} className="flex items-center gap-3 px-5 py-2">
              <span className="w-6 text-fgm">{r.rank}</span>
              <span className="flex-1 font-semibold">{r.user.avatarEmoji} {r.user.name}</span>
              <span className="text-fgm">{r.score.totalSteps.toLocaleString("ru-RU")} шагов</span>
              <span className="text-fgm">бинго {r.score.bingoCompleted.length}/9</span>
              <Pumpkins n={r.score.total} />
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
