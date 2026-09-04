import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getActiveQuest, getLeaderboard, questDates } from "@/lib/quest";
import { daysBetween, formatRuDate } from "@/lib/scoring/dates";
import { BINGO_TASKS } from "@/lib/bingo";
import { Invulnerable, Pumpkins, StreakBadge } from "@/components/pumpkins";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [user, quest] = await Promise.all([getCurrentUser(), getActiveQuest()]);
  const rows = await getLeaderboard(quest);
  const { start, end, today } = questDates(quest);
  const daysLeft = Math.max(0, daysBetween(today, end));
  const dayNo = daysBetween(start, today) + 1;
  const totalDays = daysBetween(start, end) + 1;
  const me = rows.find((r) => r.user.id === user?.id);
  const myToday = me?.score.dayMap[today];

  return (
    <div className="space-y-6">
      <section className="card overflow-hidden">
        <div className="bg-gradient-to-r from-accent/15 via-transparent to-leaf/15 p-5 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold sm:text-3xl">🍂 Операция «Анти-плед»</h1>
              <p className="mt-1 text-sm text-fgm">
                {formatRuDate(start)} – {formatRuDate(end)} · день {Math.min(Math.max(dayNo, 1), totalDays)} из {totalDays}
              </p>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold tabular-nums">{daysLeft}</div>
              <div className="text-xs uppercase tracking-wide text-fgm">дней до финала</div>
            </div>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-accent" style={{ width: `${Math.min(100, (dayNo / totalDays) * 100)}%` }} />
          </div>
          {user && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {myToday?.active ? (
                <span className="chip bg-ok-soft text-ok">✅ Сегодня уже засчитано</span>
              ) : myToday?.pending ? (
                <span className="chip bg-warn-soft text-fg">⏳ Отчёт на проверке</span>
              ) : (
                <Link href="/log" className="btn-primary">＋ Записать сегодняшнюю активность</Link>
              )}
              {me && me.score.currentStreak > 0 && (
                <span className="text-sm text-fgm">Стрик: <b>{me.score.currentStreak}</b> 🔥</span>
              )}
              {quest.votingOpen && (
                <Link href="/vote" className="btn-ghost">📸 Выбрать Амбассадора Осени</Link>
              )}
            </div>
          )}
          {!user && (
            <p className="mt-4 text-sm text-fgm">
              <Link href="/login" className="font-semibold text-accent-strong underline">Войди через Telegram</Link>, чтобы записывать активности.
            </p>
          )}
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-bold">Таблица лидеров</h2>
          <span className="text-xs text-fgm">{rows.length} участников</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-fgm">
              <tr>
                <th className="px-4 py-2">#</th>
                <th className="px-2 py-2">Участник</th>
                <th className="px-2 py-2 text-right">🎃 Всего</th>
                <th className="px-2 py-2 text-right">Дни</th>
                <th className="px-2 py-2">Стрик</th>
                <th className="px-2 py-2">Бинго</th>
                <th className="px-2 py-2 text-right">Шаги</th>
                <th className="px-2 py-2">Неделя</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isMe = r.user.id === user?.id;
                const week = Array.from({ length: 7 }, (_, i) => {
                  const d = shift(today, i - 6);
                  return { d, cell: r.score.dayMap[d] };
                });
                return (
                  <tr key={r.user.id} className={`border-t border-line ${isMe ? "bg-accent-soft/40" : ""}`}>
                    <td className="px-4 py-3 font-bold tabular-nums text-fgm">
                      {r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : r.rank}
                    </td>
                    <td className="px-2 py-3">
                      <Link href={`/u/${r.user.id}`} className="flex items-center gap-2 font-semibold hover:underline">
                        <span className="text-xl" aria-hidden>{r.user.avatarEmoji}</span>
                        <span>{r.user.name}</span>
                        <Invulnerable until={r.score.invulnerableUntil} />
                        {r.pendingCount > 0 && <span className="chip bg-warn-soft text-fg" title="Отчётов на проверке">⏳ {r.pendingCount}</span>}
                      </Link>
                    </td>
                    <td className="px-2 py-3 text-right text-base"><Pumpkins n={r.score.total} /></td>
                    <td className="px-2 py-3 text-right tabular-nums">{r.score.activeDayCount}</td>
                    <td className="px-2 py-3"><StreakBadge n={r.score.currentStreak} /></td>
                    <td className="px-2 py-3 tabular-nums">
                      <span className="font-semibold">{r.score.bingoCompleted.length}</span>
                      <span className="text-fgm">/{BINGO_TASKS.length}</span>
                    </td>
                    <td className="px-2 py-3 text-right tabular-nums">{r.score.totalSteps.toLocaleString("ru-RU")}</td>
                    <td className="px-2 py-3">
                      <div className="flex gap-0.5">
                        {week.map(({ d, cell }) => (
                          <span
                            key={d}
                            title={d}
                            className={`h-3.5 w-3.5 rounded-sm ${
                              cell?.active ? "bg-accent" : cell?.pending ? "bg-warn-soft" : "bg-muted"
                            }`}
                          />
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-fgm">Пока никого нет. Организатор, добавь участников в админке.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function shift(d: string, n: number) {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
