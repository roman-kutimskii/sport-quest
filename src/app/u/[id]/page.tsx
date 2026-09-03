import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getActiveQuest, getUserBreakdown, questDates } from "@/lib/quest";
import { BINGO_TASKS, ACTIVITY_TYPES } from "@/lib/bingo";
import { formatRuDate, toDateStr } from "@/lib/scoring/dates";
import { Invulnerable, Pumpkins, StreakBadge } from "@/components/pumpkins";
import { QuestCalendar } from "@/components/calendar";
import { Proof } from "@/components/proof";
import { deleteOwnReport } from "@/app/log/actions";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; cls: string }> = {
  APPROVED: { label: "засчитано", cls: "bg-ok-soft text-ok" },
  PENDING: { label: "на проверке", cls: "bg-warn-soft text-fg" },
  REJECTED: { label: "отклонено", cls: "bg-danger-soft text-danger" },
};

export default async function ProfilePage({ params, searchParams }: PageProps<"/u/[id]">) {
  const { id } = await params;
  const { saved } = await searchParams;
  const [viewer, quest] = await Promise.all([getCurrentUser(), getActiveQuest()]);
  const data = await getUserBreakdown(quest, id);
  if (!data) notFound();
  const { user, score, reports, adjustments } = data;
  const { start, end, today } = questDates(quest);
  const isMe = viewer?.id === user.id;
  const canSeeProof = !!viewer;

  return (
    <div className="space-y-6">
      {saved && <div className="rounded-xl bg-ok-soft p-3 text-sm text-ok">Отчёт сохранён! 🎃</div>}

      <section className="card p-5">
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-5xl" aria-hidden>{user.avatarEmoji}</span>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{user.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-fgm">
              <StreakBadge n={score.currentStreak} />
              <Invulnerable until={score.invulnerableUntil} />
              {user.isAdmin && <span className="chip bg-muted text-fgm">организатор</span>}
            </div>
          </div>
          <div className="text-right">
            <Pumpkins n={score.total} className="text-4xl" />
            <div className="text-xs uppercase tracking-wide text-fgm">всего</div>
          </div>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          <Stat label="Активные дни" value={`${score.activeDayCount} 🎃`} />
          <Stat label="Бонусы за стрик" value={`+${score.streakBonus} 🎃`} />
          <Stat label="Бинго" value={`${score.bingoCompleted.length}/9 · +${score.bingoPoints} 🎃`} />
          <Stat label="Корректировки" value={`${score.adjustments >= 0 ? "+" : ""}${score.adjustments} 🎃`} />
          <Stat label="Шаги" value={score.totalSteps.toLocaleString("ru-RU")} />
        </dl>
        {isMe && <Link href="/log" className="btn-primary mt-5 w-full sm:w-auto">＋ Записать отчёт</Link>}
      </section>

      <section className="card p-5">
        <h2 className="mb-4 font-bold">Календарь</h2>
        <QuestCalendar start={start} end={end} today={today} dayMap={score.dayMap} />
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-fgm">
          <Legend cls="bg-accent" label="активный день" />
          <Legend cls="bg-accent-strong" label="день с бонусом за стрик" />
          <Legend cls="bg-warn-soft" label="на проверке" />
          <span>🎯 — бинго</span>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="mb-4 font-bold">Осеннее Бинго</h2>
        <div className="grid grid-cols-3 gap-2">
          {BINGO_TASKS.map((t) => {
            const done = score.bingoCompleted.find((b) => b.key === t.key);
            const pending = reports.find((r) => r.kind === "BINGO" && r.bingoKey === t.key && r.status === "PENDING");
            return (
              <div key={t.key} className={`rounded-xl border p-3 text-xs ${done ? "border-accent bg-accent-soft" : pending ? "border-line bg-warn-soft" : "border-line bg-muted opacity-70"}`} title={t.description}>
                <div className="text-2xl">{t.emoji}</div>
                <div className="mt-1 font-semibold leading-tight">{t.title}</div>
                <div className="mt-1 text-fgm">{done ? `✓ ${formatRuDate(done.date)}` : pending ? "⏳ на проверке" : "—"}</div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-line px-5 py-3 font-bold">История отчётов</h2>
        {reports.length === 0 && <p className="p-5 text-sm text-fgm">Пока пусто.</p>}
        <ul className="divide-y divide-line">
          {reports.map((r) => {
            const d = toDateStr(r.date);
            const type = ACTIVITY_TYPES.find((t) => t.key === r.activityType);
            const bingo = BINGO_TASKS.find((t) => t.key === r.bingoKey);
            const st = STATUS[r.status];
            return (
              <li key={r.id} className="flex gap-4 px-5 py-3 text-sm">
                <div className="w-24 shrink-0 text-fgm">{formatRuDate(d)}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">
                      {r.kind === "BINGO" ? `🎯 ${bingo?.emoji ?? ""} ${bingo?.title ?? r.bingoKey}` : `${type?.emoji ?? "✨"} ${type?.title ?? "Активность"}`}
                    </span>
                    {r.durationMin ? <span className="text-fgm">{r.durationMin} мин</span> : null}
                    {r.steps ? <span className="text-fgm">{r.steps.toLocaleString("ru-RU")} шагов</span> : null}
                    <span className={`chip ${st.cls}`}>{st.label}</span>
                  </div>
                  {r.comment && <div className="mt-1 text-fgm">{r.comment}</div>}
                  {r.status === "REJECTED" && r.rejectReason && <div className="mt-1 text-danger">Причина: {r.rejectReason}</div>}
                  {canSeeProof && r.proofUrl && <div className="mt-2"><Proof url={r.proofUrl} className="max-h-40" /></div>}
                </div>
                {isMe && (
                  <form action={deleteOwnReport}>
                    <input type="hidden" name="id" value={r.id} />
                    <button className="text-xs text-fgm hover:text-danger" title="Удалить отчёт">удалить</button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {adjustments.length > 0 && (
        <section className="card overflow-hidden">
          <h2 className="border-b border-line px-5 py-3 font-bold">Корректировки организатора</h2>
          <ul className="divide-y divide-line text-sm">
            {adjustments.map((a) => (
              <li key={a.id} className="flex gap-4 px-5 py-3">
                <span className={`w-16 shrink-0 font-bold ${a.delta >= 0 ? "text-ok" : "text-danger"}`}>{a.delta >= 0 ? "+" : ""}{a.delta} 🎃</span>
                <span>{a.comment}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted p-3">
      <dt className="text-xs text-fgm">{label}</dt>
      <dd className="mt-0.5 font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
function Legend({ cls, label }: { cls: string; label: string }) {
  return <span className="inline-flex items-center gap-1"><span className={`h-3 w-3 rounded-sm ${cls}`} />{label}</span>;
}
