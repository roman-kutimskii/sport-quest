import Link from "next/link";
import { prisma } from "@/lib/db";
import { fmt, health, requestTime } from "./bot/data";

export function HealthLine({ h }: { h: Awaited<ReturnType<typeof health>> }) {
  return (
    <p className="mt-1 text-xs text-fgm">
      <span className={h.pollStale ? "text-danger" : "text-ok"}>последний опрос Telegram: {fmt(h.pollAt)}</span>
      {" · "}очередь отправки: {h.outboxPending}{h.outboxFailed ? ` (ошибок: ${h.outboxFailed})` : ""}
      {" · "}ошибок LLM за 24 ч: <span className={h.llmErrors ? "text-danger" : ""}>{h.llmErrors}</span>
    </p>
  );
}

/** Compact summary on the main admin page; the full feed lives at /admin/bot. */
export async function BotSection({ mode }: { mode: string }) {
  const now = requestTime();
  const dayAgo = new Date(now - 24 * 3600 * 1000);
  const [h, saved, asked, failed] = await Promise.all([
    health(now),
    prisma.telegramLink.count({ where: { status: "SAVED", messageDate: { gte: dayAgo } } }),
    prisma.telegramLink.count({ where: { status: "ASKED" } }),
    prisma.telegramLink.count({ where: { status: "FAILED", messageDate: { gte: dayAgo } } }),
  ]);
  const needsAttention = asked + failed;
  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-bold">🤖 Бот <span className="text-fgm">({mode})</span></h2>
          <HealthLine h={h} />
        </div>
        <Link href="/admin/bot" className="btn-ghost !py-1.5 text-sm">
          сообщения →{needsAttention > 0 && <span className="chip bg-danger-soft text-danger">{needsAttention}</span>}
        </Link>
      </div>
      <p className="mt-3 text-sm">
        За сутки: <b>{saved}</b> записано{failed ? <>, <span className="text-danger">{failed} ошибок</span></> : ""}
        {asked ? <>, <span className="text-fg">{asked} ждут ответа</span></> : ""}.
      </p>
    </section>
  );
}
