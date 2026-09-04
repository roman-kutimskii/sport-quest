import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { computeNominations, getActiveQuest, getLeaderboard } from "@/lib/quest";
import { ACTIVITY_TYPES, BINGO_TASKS } from "@/lib/bingo";
import { formatRuDate, toDateStr } from "@/lib/scoring/dates";
import { Proof } from "@/components/proof";
import { NOMINATIONS } from "@/lib/nominations";
import { addAdjustment, approveAllPending, reviewReport, setNomination, toggleUser, updateQuestSettings } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireAdmin();
  const quest = await getActiveQuest();

  const [pending, users, rows, manual] = await Promise.all([
    prisma.report.findMany({ where: { questId: quest.id, status: "PENDING" }, include: { user: true }, orderBy: { createdAt: "asc" } }),
    prisma.user.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }] }),
    getLeaderboard(quest),
    prisma.nominationResult.findMany({ where: { questId: quest.id } }),
  ]);
  const auto = computeNominations(rows);
  const autoWinner: Record<string, string | undefined> = {
    pumpkinLord: auto.pumpkinLord?.user.name,
    frodo: auto.frodo?.user.name,
    bingoMaster: auto.bingoMaster?.row.user.name,
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Админка 🛠️</h1>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-bold">На проверке <span className="text-fgm">({pending.length})</span></h2>
          {pending.length > 0 && (
            <form action={approveAllPending}><button className="btn-ok !py-1.5">Одобрить все</button></form>
          )}
        </div>
        {pending.length === 0 && <p className="p-5 text-sm text-fgm">Очередь пуста 🎉</p>}
        <ul className="divide-y divide-line">
          {pending.map((r) => {
            const type = ACTIVITY_TYPES.find((t) => t.key === r.activityType);
            const bingo = BINGO_TASKS.find((t) => t.key === r.bingoKey);
            return (
              <li key={r.id} className="grid gap-3 px-5 py-4 text-sm sm:grid-cols-[1fr_auto]">
                <div className="flex gap-3">
                  {r.proofUrl && <Proof url={r.proofUrl} className="h-24 w-24 shrink-0" />}
                  <div>
                    <div className="font-semibold">{r.user.avatarEmoji} {r.user.name} · {formatRuDate(toDateStr(r.date))}</div>
                    <div>{r.kind === "BINGO" ? `🎯 ${bingo?.emoji} ${bingo?.title}` : `${type?.emoji ?? "✨"} ${type?.title ?? "Активность"}`}
                      {r.durationMin ? ` · ${r.durationMin} мин` : ""}{r.steps ? ` · ${r.steps.toLocaleString("ru-RU")} шагов` : ""}</div>
                    {r.comment && <div className="text-fgm">{r.comment}</div>}
                  </div>
                </div>
                <form action={reviewReport} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={r.id} />
                  <input name="reason" className="input !w-44" placeholder="причина отказа" />
                  <button name="decision" value="approve" className="btn-ok !py-1.5">✓</button>
                  <button name="decision" value="reject" className="btn-danger !py-1.5">✕</button>
                </form>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card p-5">
        <h2 className="font-bold">Участники</h2>
        <ul className="mt-3 divide-y divide-line text-sm">
          {users.map((u) => {
            return (
              <li key={u.id} className={`flex flex-wrap items-center gap-2 py-2 ${u.isActive ? "" : "opacity-50"}`}>
                <span className="w-40 font-semibold">{u.avatarEmoji} {u.name}{u.isAdmin && " 👑"}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-fgm">{u.telegramHandle ? `@${u.telegramHandle}` : "—"}</span>
                <form action={toggleUser} className="flex gap-1">
                  <input type="hidden" name="id" value={u.id} />
                  <button name="field" value="isActive" className="btn-ghost !px-2 !py-1 text-xs">{u.isActive ? "деактивировать" : "активировать"}</button>
                  <button name="field" value="isAdmin" className="btn-ghost !px-2 !py-1 text-xs">{u.isAdmin ? "снять админа" : "сделать админом"}</button>
                </form>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card p-5">
        <h2 className="font-bold">Корректировка баллов</h2>
        <form action={addAdjustment} className="mt-3 grid gap-2 sm:grid-cols-[1fr_6rem_2fr_auto]">
          <select name="userId" className="input" required>
            {users.filter((u) => u.isActive).map((u) => <option key={u.id} value={u.id}>{u.avatarEmoji} {u.name}</option>)}
          </select>
          <input name="delta" className="input" placeholder="+3 / -1" required />
          <input name="comment" className="input" placeholder="За что (обязательно)" required />
          <button className="btn-primary">Применить</button>
        </form>
      </section>

      <section className="card p-5">
        <h2 className="font-bold">Номинации</h2>
        <p className="mt-1 text-xs text-fgm">Автоматически считаются три номинации; здесь можно переопределить любую и назначить «Амбассадора Осени».</p>
        <div className="mt-3 space-y-2 text-sm">
          {NOMINATIONS.map((n) => {
            const m = manual.find((x) => x.key === n.key);
            return (
              <form key={n.key} action={setNomination} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="key" value={n.key} />
                <span className="w-72 font-semibold">{n.emoji} {n.title}</span>
                <span className="text-xs text-fgm">авто: {autoWinner[n.key] ?? "—"}</span>
                <select name="userId" className="input !w-48" defaultValue={m?.userId ?? ""}>
                  <option value="">— авто —</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.avatarEmoji} {u.name}</option>)}
                </select>
                <button className="btn-ghost !py-1.5">Сохранить</button>
              </form>
            );
          })}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-bold">Настройки квеста</h2>
        <form action={updateQuestSettings} className="mt-3 space-y-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" name="autoApprove" defaultChecked={quest.autoApprove} className="h-4 w-4 accent-accent" /> Засчитывать отчёты сразу (без модерации)</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="resultsPublished" defaultChecked={quest.resultsPublished} className="h-4 w-4 accent-accent" /> Опубликовать итоги (страница «Итоги» видна всем)</label>
          <button className="btn-primary">Сохранить</button>
        </form>
      </section>
    </div>
  );
}
