import { prisma } from "@/lib/db";
import { activityLabel, BINGO_TASKS } from "@/lib/bingo";
import type { Prisma, TelegramLinkStatus } from "@/generated/prisma/client";

export const STATUS: Record<string, { label: string; cls: string }> = {
  RECEIVED: { label: "в очереди", cls: "bg-muted text-fgm" },
  SKIPPED: { label: "не отчёт", cls: "bg-muted text-fgm" },
  ASKED: { label: "спросил", cls: "bg-warn-soft text-fg" },
  SAVED: { label: "записан", cls: "bg-ok-soft text-ok" },
  UNDONE: { label: "отменён", cls: "bg-muted text-fgm" },
  FAILED: { label: "ошибка", cls: "bg-danger-soft text-danger" },
};

/** Filter chips in display order; `all` means every status. */
export const FILTERS: { key: string; label: string; statuses: TelegramLinkStatus[] }[] = [
  { key: "important", label: "важное", statuses: ["SAVED", "ASKED", "FAILED", "UNDONE"] },
  { key: "all", label: "все", statuses: ["RECEIVED", "SKIPPED", "ASKED", "SAVED", "UNDONE", "FAILED"] },
  { key: "SAVED", label: "записан", statuses: ["SAVED"] },
  { key: "ASKED", label: "спросил", statuses: ["ASKED"] },
  { key: "FAILED", label: "ошибка", statuses: ["FAILED"] },
  { key: "SKIPPED", label: "не отчёт", statuses: ["SKIPPED"] },
];

export const ALBUM_SIBLING = "album sibling";

/**
 * "Not an album sibling", null-safe: Prisma renders `NOT: { error: X }` as bare `NOT (error = X)`,
 * which is UNKNOWN — and so excludes the row — for the null `error` most rows have.
 */
const NOT_ALBUM_SIBLING: Prisma.TelegramLinkWhereInput[] = [{ error: null }, { error: { not: ALBUM_SIBLING } }];

type Extraction = {
  is_report?: boolean; confidence?: number; date?: string | null; activity_type?: string | null; activity_types?: string[];
  steps?: number | null; bingo_key?: string | null; bingo_confidence?: number; summary_ru?: string;
};

export function describeExtraction(raw: unknown): string {
  const e = raw as Extraction | null;
  if (!e) return "";
  if (!e.is_report) return e.summary_ru && e.summary_ru !== "не отчёт" ? e.summary_ru : "";
  const parts: string[] = [];
  const keys = e.activity_types ?? (e.activity_type ? [e.activity_type] : []);
  if (keys.length) { const type = activityLabel(keys); parts.push(`${type.emoji} ${type.title}`); }
  if (e.steps) parts.push(`${e.steps.toLocaleString("ru-RU")} шагов`);
  const bingo = BINGO_TASKS.find((t) => t.key === e.bingo_key);
  if (bingo) parts.push(`🎯 ${bingo.title}${e.bingo_confidence != null ? ` (${Math.round(e.bingo_confidence * 100)}%)` : ""}`);
  if (e.date) parts.push(e.date);
  return parts.join(" · ") || (e.summary_ru ?? "");
}

export const fmt = (d: Date | null | undefined) =>
  d ? new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d) : "—";

export const mediaIcons = (kinds: string[]) => kinds.map((k) => (k === "photo" ? "📷" : k === "video" ? "🎬" : "📎")).join("");

type UserLite = { id: string; name: string; avatarEmoji: string } | null;

export type FeedRow = Prisma.TelegramLinkGetPayload<{ include: { reports: { select: { id: true } } } }> & {
  user: UserLite;
  /** Media kinds of the whole album (primary + folded siblings). */
  albumMedia: string[];
};

async function attachUsers<T extends { userId: string | null }>(rows: T[]): Promise<(T & { user: UserLite })[]> {
  const ids = [...new Set(rows.map((r) => r.userId).filter((id): id is string => !!id))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, avatarEmoji: true } }) : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows.map((r) => ({ ...r, user: r.userId ? byId.get(r.userId) ?? null : null }));
}

/**
 * Album siblings are stored as SKIPPED rows with the same mediaGroupId; fold their media into the
 * primary row and drop them from the list.
 */
export function foldAlbums<T extends { id: string; mediaGroupId: string | null; mediaKinds: string[]; error: string | null }>(
  rows: T[],
  siblingMedia: Map<string, string[]>,
): (T & { albumMedia: string[] })[] {
  return rows
    .filter((r) => r.error !== ALBUM_SIBLING)
    .map((r) => ({ ...r, albumMedia: [...r.mediaKinds, ...(r.mediaGroupId ? siblingMedia.get(r.mediaGroupId) ?? [] : [])] }));
}

export async function health(now: number) {
  const dayAgo = new Date(now - 24 * 3600 * 1000);
  const [lastPoll, outboxPending, outboxFailed, llmErrors] = await Promise.all([
    prisma.botState.findUnique({ where: { key: "health.lastPollAt" } }),
    prisma.outbox.count({ where: { status: "PENDING" } }),
    prisma.outbox.count({ where: { status: "FAILED" } }),
    prisma.telegramLink.count({ where: { status: "FAILED", createdAt: { gte: dayAgo } } }),
  ]);
  const pollAt = typeof lastPoll?.value === "string" ? new Date(lastPoll.value) : null;
  return { pollAt, pollStale: !pollAt || now - pollAt.getTime() > 5 * 60 * 1000, outboxPending, outboxFailed, llmErrors };
}

/** Rows an admin has to look at: unanswered questions, failures, and saved rows with a warning. */
export async function attention(): Promise<FeedRow[]> {
  const rows = await prisma.telegramLink.findMany({
    where: {
      OR: [
        { status: "ASKED" },
        { status: "FAILED" },
        { status: "SAVED", error: { not: null } },
      ],
    },
    orderBy: { messageDate: "desc" },
    take: 50,
    include: { reports: { select: { id: true } } },
  });
  return attachUsers(foldAlbums(rows, new Map()));
}

export async function feed(opts: { statuses: TelegramLinkStatus[]; take: number; since: Date }): Promise<{ rows: FeedRow[]; hasMore: boolean }> {
  const raw = await prisma.telegramLink.findMany({
    where: { status: { in: opts.statuses }, messageDate: { gte: opts.since }, OR: NOT_ALBUM_SIBLING },
    orderBy: { messageDate: "desc" },
    take: opts.take + 1,
    include: { reports: { select: { id: true } } },
  });
  const hasMore = raw.length > opts.take;
  const page = raw.slice(0, opts.take);
  const groupIds = page.map((r) => r.mediaGroupId).filter((g): g is string => !!g);
  const siblings = groupIds.length
    ? await prisma.telegramLink.findMany({ where: { mediaGroupId: { in: groupIds }, error: ALBUM_SIBLING }, select: { mediaGroupId: true, mediaKinds: true } })
    : [];
  const siblingMedia = new Map<string, string[]>();
  for (const s of siblings) siblingMedia.set(s.mediaGroupId!, [...(siblingMedia.get(s.mediaGroupId!) ?? []), ...s.mediaKinds]);
  return { rows: await attachUsers(foldAlbums(page, siblingMedia)), hasMore };
}

export async function statusCounts(since: Date): Promise<Record<string, number>> {
  const groups = await prisma.telegramLink.groupBy({ by: ["status"], where: { messageDate: { gte: since }, OR: NOT_ALBUM_SIBLING }, _count: { _all: true } });
  return Object.fromEntries(groups.map((g) => [g.status, g._count._all]));
}

export type UserRollup = {
  key: string;
  who: string;
  hasAccount: boolean;
  counts: Record<string, number>;
  lastAt: Date;
  lastSavedAt: Date | null;
};

/** Per-sender rollup over the range, sorted by most recent message. */
export async function userRollup(since: Date): Promise<UserRollup[]> {
  const rows = await prisma.telegramLink.findMany({
    where: { messageDate: { gte: since }, OR: NOT_ALBUM_SIBLING },
    select: { userId: true, fromUserId: true, fromName: true, status: true, messageDate: true },
  });
  const withUsers = await attachUsers(rows);
  const map = new Map<string, UserRollup>();
  for (const r of withUsers) {
    const key = r.userId ?? `tg:${r.fromUserId}`;
    const cur = map.get(key) ?? {
      key,
      who: r.user ? `${r.user.avatarEmoji} ${r.user.name}` : (r.fromName ?? r.fromUserId),
      hasAccount: !!r.user,
      counts: {},
      lastAt: r.messageDate,
      lastSavedAt: null,
    };
    cur.counts[r.status] = (cur.counts[r.status] ?? 0) + 1;
    if (r.messageDate > cur.lastAt) cur.lastAt = r.messageDate;
    if (r.status === "SAVED" && (!cur.lastSavedAt || r.messageDate > cur.lastSavedAt)) cur.lastSavedAt = r.messageDate;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
}

/** Server components render per request; reading the clock here is intentional. */
export function requestTime(): number {
  return Date.now();
}
