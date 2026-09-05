import { prisma } from "@/lib/db";
import { messageLink } from "@/lib/bot/undo";
import { ACTIVITY_TYPES, BINGO_TASKS } from "@/lib/bingo";
import { undoTelegramLink } from "./actions";

const STATUS: Record<string, { label: string; cls: string }> = {
  RECEIVED: { label: "в очереди", cls: "bg-muted text-fgm" },
  SKIPPED: { label: "не отчёт", cls: "bg-muted text-fgm" },
  ASKED: { label: "спросил", cls: "bg-warn-soft text-fg" },
  SAVED: { label: "записан", cls: "bg-ok-soft text-ok" },
  UNDONE: { label: "отменён", cls: "bg-muted text-fgm" },
  FAILED: { label: "ошибка", cls: "bg-danger-soft text-danger" },
};

type Extraction = {
  is_report?: boolean; confidence?: number; date?: string | null; activity_type?: string | null;
  steps?: number | null; bingo_key?: string | null; bingo_confidence?: number; summary_ru?: string;
};

function describeExtraction(e: Extraction | null): string {
  if (!e) return "";
  if (!e.is_report) return e.summary_ru && e.summary_ru !== "не отчёт" ? e.summary_ru : "";
  const parts: string[] = [];
  const type = ACTIVITY_TYPES.find((t) => t.key === e.activity_type);
  if (type) parts.push(`${type.emoji} ${type.title}`);
  if (e.steps) parts.push(`${e.steps.toLocaleString("ru-RU")} шагов`);
  const bingo = BINGO_TASKS.find((t) => t.key === e.bingo_key);
  if (bingo) parts.push(`🎯 ${bingo.title}${e.bingo_confidence != null ? ` (${Math.round(e.bingo_confidence * 100)}%)` : ""}`);
  if (e.date) parts.push(e.date);
  return parts.join(" · ") || (e.summary_ru ?? "");
}

/** Server component rendered per request; reading the clock here is intentional (health line). */
function requestTime(): number {
  return Date.now();
}

const fmt = (d: Date | null | undefined) =>
  d ? new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d) : "—";

export async function BotSection({ mode }: { mode: string }) {
  const now = requestTime();
  const dayAgo = new Date(now - 24 * 3600 * 1000);
  const [rawLinks, lastPoll, outboxPending, outboxFailed, llmErrors] = await Promise.all([
    prisma.telegramLink.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { reports: { select: { id: true } } } }),
    prisma.botState.findUnique({ where: { key: "health.lastPollAt" } }),
    prisma.outbox.count({ where: { status: "PENDING" } }),
    prisma.outbox.count({ where: { status: "FAILED" } }),
    prisma.telegramLink.count({ where: { status: "FAILED", createdAt: { gte: dayAgo } } }),
  ]);
  const userIds = [...new Set(rawLinks.map((l) => l.userId).filter((id): id is string => !!id))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, avatarEmoji: true } }) : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  const links = rawLinks.map((l) => ({ ...l, user: l.userId ? byId.get(l.userId) ?? null : null }));
  const pollAt = typeof lastPoll?.value === "string" ? new Date(lastPoll.value) : null;
  const pollStale = !pollAt || now - pollAt.getTime() > 5 * 60 * 1000;

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-line px-5 py-3">
        <h2 className="font-bold">🤖 Бот <span className="text-fgm">({mode})</span></h2>
        <p className="mt-1 text-xs text-fgm">
          <span className={pollStale ? "text-danger" : "text-ok"}>последний опрос Telegram: {fmt(pollAt)}</span>
          {" · "}очередь отправки: {outboxPending}{outboxFailed ? ` (ошибок: ${outboxFailed})` : ""}
          {" · "}ошибок LLM за 24 ч: <span className={llmErrors ? "text-danger" : ""}>{llmErrors}</span>
        </p>
      </div>
      {links.length === 0 && <p className="p-5 text-sm text-fgm">Сообщений из группы пока не было.</p>}
      <ul className="divide-y divide-line text-sm">
        {links.map((l) => {
          const st = STATUS[l.status] ?? { label: l.status, cls: "bg-muted" };
          const url = messageLink(l.chatId, l.messageId, l.threadId);
          const who = l.user ? `${l.user.avatarEmoji} ${l.user.name}` : (l.fromName ?? l.fromUserId);
          return (
            <li key={l.id} className="grid gap-1 px-5 py-3 sm:grid-cols-[7rem_1fr_auto] sm:items-start sm:gap-3">
              <div className="text-xs text-fgm">{fmt(l.messageDate)}</div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{who}</span>
                  <span className={`chip ${st.cls}`}>{st.label}</span>
                  {l.confidence != null && <span className="text-xs text-fgm">{Math.round(l.confidence * 100)}%</span>}
                  {l.mediaKinds.length > 0 && <span className="text-xs text-fgm">{l.mediaKinds.map((k) => (k === "photo" ? "📷" : k === "video" ? "🎬" : "📎")).join("")}</span>}
                </div>
                {l.text && <div className="truncate text-fgm" title={l.text}>{l.text}</div>}
                {l.extraction && <div className="text-xs">{describeExtraction(l.extraction as Extraction)}</div>}
                {l.error && <div className="text-xs text-danger">{l.error}</div>}
              </div>
              <div className="flex items-center gap-2">
                {url && <a href={url} target="_blank" rel="noreferrer" className="btn-ghost !px-2 !py-1 text-xs">открыть</a>}
                {l.reports.length > 0 && (
                  <form action={undoTelegramLink}>
                    <input type="hidden" name="id" value={l.id} />
                    <button className="btn-danger !px-2 !py-1 text-xs">удалить отчёты ({l.reports.length})</button>
                  </form>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
