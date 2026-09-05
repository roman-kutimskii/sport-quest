import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { HealthLine } from "../bot-section";
import { FILTERS, STATUS, attention, feed, fmt, health, requestTime, statusCounts, userRollup } from "./data";
import { LinkRow } from "./row";

export const dynamic = "force-dynamic";

const PAGE = 50;
const RANGES = [1, 7, 30] as const;

type Search = { view?: string; f?: string; days?: string; n?: string };

function href(q: Search): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v && !(k === "f" && v === "important") && !(k === "view" && v === "feed") && !(k === "days" && v === "7") && !(k === "n" && v === String(PAGE))) p.set(k, v);
  const s = p.toString();
  return s ? `/admin/bot?${s}` : "/admin/bot";
}

export default async function BotPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin();
  const sp = await searchParams;
  const view = sp.view === "users" ? "users" : "feed";
  const filter = FILTERS.find((f) => f.key === sp.f) ?? FILTERS[0];
  const days = RANGES.includes(Number(sp.days) as (typeof RANGES)[number]) ? Number(sp.days) : 7;
  const take = Math.min(Math.max(Number(sp.n) || PAGE, PAGE), 1000);
  const now = requestTime();
  const since = new Date(now - days * 24 * 3600 * 1000);
  const q: Search = { view, f: filter.key, days: String(days) };

  const [h, urgent, counts, page, rollup] = await Promise.all([
    health(now),
    attention(),
    statusCounts(since),
    view === "feed" ? feed({ statuses: filter.statuses, take, since }) : Promise.resolve(null),
    view === "users" ? userRollup(since) : Promise.resolve(null),
  ]);
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  const countFor = (key: string) => (key === "all" ? total : FILTERS.find((f) => f.key === key)!.statuses.reduce((s, st) => s + (counts[st] ?? 0), 0));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-fgm hover:underline">← Админка</Link>
        <h1 className="mt-1 text-2xl font-bold">🤖 Сообщения бота <span className="text-fgm">({process.env.BOT_MODE ?? "off"})</span></h1>
        <HealthLine h={h} />
      </div>

      {urgent.length > 0 && (
        <section className="card overflow-hidden border-danger/40">
          <div className="border-b border-line px-5 py-3">
            <h2 className="font-bold">⚠️ Требует внимания <span className="text-fgm">({urgent.length})</span></h2>
            <p className="mt-1 text-xs text-fgm">Ждут ответа участника, упали с ошибкой или записаны с предупреждением.</p>
          </div>
          <ul className="divide-y divide-line text-sm">
            {urgent.map((l) => <LinkRow key={l.id} l={l} />)}
          </ul>
        </section>
      )}

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-5 py-3 text-sm">
          <div className="flex gap-1">
            {(["feed", "users"] as const).map((v) => (
              <Link key={v} href={href({ ...q, view: v })} className={`chip ${view === v ? "bg-accent-soft text-fg" : "bg-muted text-fgm"}`}>
                {v === "feed" ? "лента" : "по участникам"}
              </Link>
            ))}
          </div>
          <div className="flex gap-1">
            {RANGES.map((d) => (
              <Link key={d} href={href({ ...q, days: String(d) })} className={`chip ${days === d ? "bg-accent-soft text-fg" : "bg-muted text-fgm"}`}>
                {d === 1 ? "сутки" : `${d} дней`}
              </Link>
            ))}
          </div>
          {view === "feed" && (
            <div className="flex flex-wrap gap-1">
              {FILTERS.map((f) => (
                <Link key={f.key} href={href({ ...q, f: f.key })} className={`chip ${filter.key === f.key ? "bg-accent-soft text-fg" : "bg-muted text-fgm"}`}>
                  {f.label} <span className="opacity-70">{countFor(f.key)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {view === "feed" && page && (
          <>
            {page.rows.length === 0 && <p className="p-5 text-sm text-fgm">Ничего нет за выбранный период.</p>}
            <ul className="divide-y divide-line text-sm">
              {page.rows.map((l) => <LinkRow key={l.id} l={l} />)}
            </ul>
            {page.hasMore && (
              <div className="border-t border-line p-3 text-center">
                <Link href={href({ ...q, n: String(take + PAGE) })} className="btn-ghost !py-1.5 text-sm">показать ещё</Link>
              </div>
            )}
          </>
        )}

        {view === "users" && rollup && (
          <>
            {rollup.length === 0 && <p className="p-5 text-sm text-fgm">Сообщений за выбранный период не было.</p>}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-fgm">
                  <tr>
                    <th className="px-5 py-2 font-medium">участник</th>
                    {(["SAVED", "ASKED", "FAILED", "SKIPPED"] as const).map((s) => <th key={s} className="px-2 py-2 text-right font-medium">{STATUS[s].label}</th>)}
                    <th className="px-2 py-2 font-medium">последний отчёт</th>
                    <th className="px-5 py-2 font-medium">последнее сообщение</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rollup.map((u) => (
                    <tr key={u.key} className={u.counts.SAVED ? "" : "text-fgm"}>
                      <td className="px-5 py-2 font-semibold">
                        {u.who}{!u.hasAccount && <span className="chip ml-2 bg-warn-soft text-fg">без аккаунта</span>}
                      </td>
                      {(["SAVED", "ASKED", "FAILED", "SKIPPED"] as const).map((s) => (
                        <td key={s} className={`px-2 py-2 text-right tabular-nums ${u.counts[s] && s === "FAILED" ? "text-danger" : u.counts[s] && s === "SAVED" ? "text-ok" : ""}`}>
                          {u.counts[s] ?? "·"}
                        </td>
                      ))}
                      <td className="px-2 py-2 text-xs">{fmt(u.lastSavedAt)}</td>
                      <td className="px-5 py-2 text-xs">{fmt(u.lastAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
