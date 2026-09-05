import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getActiveQuest, getUserBreakdown, questDates } from "@/lib/quest";
import { BINGO_TASKS, activityLabel } from "@/lib/bingo";
import { formatRuDate, toDateStr } from "@/lib/scoring/dates";
import { Invulnerable, Pumpkins, StreakBadge } from "@/components/pumpkins";
import { QuestCalendar } from "@/components/calendar";
import { Proofs } from "@/components/proof";
import { MyGallery } from "./my-gallery";
import { deleteOwnReport } from "@/app/log/actions";
import { ProfileForm } from "./profile-form";
import { messageLink } from "@/lib/bot/undo";

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
        {isMe && (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link href="/log" className="btn-primary w-full border border-transparent sm:w-auto">＋ Записать отчёт</Link>
            <ProfileForm name={user.name} avatarEmoji={user.avatarEmoji} />
          </div>
        )}
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

      {isMe && <MyGallery reports={reports} />}

      <section className="card overflow-hidden">
        <h2 className="border-b border-line px-5 py-3 font-bold">История отчётов</h2>
        {reports.length === 0 && <p className="p-5 text-sm text-fgm">Пока пусто.</p>}
        <ul className="divide-y divide-line">
          {groupSubmissions(reports).map((group) => {
            const first = group[0];
            const d = toDateStr(first.date);
            return (
              <li key={first.id} className="flex gap-4 px-5 py-3 text-sm">
                <div className="w-24 shrink-0 text-fgm">{formatRuDate(d)}</div>
                <div className="min-w-0 flex-1 space-y-1">
                  {group.map((r) => {
                    const type = activityLabel(r.activityTypes);
                    const bingo = BINGO_TASKS.find((t) => t.key === r.bingoKey);
                    const st = STATUS[r.status];
                    return (
                      <div key={r.id} className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">
                              {r.kind === "BINGO" ? `🎯 ${bingo?.emoji ?? ""} ${bingo?.title ?? r.bingoKey}` : r.kind === "STEPS" ? "👣 Только шаги" : `${type.emoji} ${type.title}`}
                            </span>
                            {r.steps ? <span className="text-fgm">{r.steps.toLocaleString("ru-RU")} шагов</span> : null}
                            <span className={`chip ${st.cls}`}>{st.label}</span>
                            {r.source === "TELEGRAM" && <TelegramMark link={r.link} />}
                          </div>
                          {r.status === "REJECTED" && r.rejectReason && <div className="mt-1 text-danger">Причина: {r.rejectReason}</div>}
                        </div>
                        {isMe && (
                          <form action={deleteOwnReport}>
                            <input type="hidden" name="id" value={r.id} />
                            <button className="text-xs text-fgm hover:text-danger" title="Удалить отчёт">удалить</button>
                          </form>
                        )}
                      </div>
                    );
                  })}
                  {first.comment && <div className="text-fgm">{first.comment}</div>}
                  {canSeeProof && first.proofUrls.length > 0 && <div className="mt-2"><Proofs urls={first.proofUrls} className="max-h-40" /></div>}
                </div>
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

/**
 * One form submission may create several reports (activity + bingo) that share the same date,
 * comment and photos. Show them as one row so the photos are not repeated (photo-less reports stay separate).
 */
function groupSubmissions<T extends { date: Date; comment: string | null; proofUrls: string[] }>(reports: T[]): T[][] {
  const groups: T[][] = [];
  const index = new Map<string, T[]>();
  for (const r of reports) {
    if (r.proofUrls.length === 0) { groups.push([r]); continue; }
    const key = `${toDateStr(r.date)}|${r.comment ?? ""}|${[...r.proofUrls].sort().join(",")}`;
    const g = index.get(key);
    if (g) g.push(r);
    else { const ng = [r]; index.set(key, ng); groups.push(ng); }
  }
  return groups;
}

/** Small marker on reports the group bot filed, linking to the original message. */
function TelegramMark({ link }: { link: { chatId: string; messageId: number; threadId: number | null } | null }) {
  const url = link ? messageLink(link.chatId, link.messageId, link.threadId) : null;
  const icon = (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden fill="currentColor">
      <path d="M21.4 4.6 3.6 11.5c-1.2.5-1.2 1.2-.2 1.5l4.5 1.4 1.7 5.3c.2.6.1.8.7.8.5 0 .7-.2 1-.5l2.4-2.3 4.9 3.6c.9.5 1.5.2 1.8-.8l3.2-15c.3-1.3-.5-1.9-1.4-1.5zM8.7 14.1l9.2-5.8c.5-.3.9-.1.5.2l-7.6 6.9-.3 3.2-1.8-4.5z" />
    </svg>
  );
  const cls = "inline-flex items-center gap-1 text-xs text-fgm hover:text-accent";
  return url
    ? <a href={url} target="_blank" rel="noreferrer" className={cls} title="Записано ботом из сообщения в группе">{icon}<span>из чата</span></a>
    : <span className={cls} title="Записано ботом из группы">{icon}<span>из чата</span></span>;
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
