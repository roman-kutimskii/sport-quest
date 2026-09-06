import { prisma, ReportSource, type Report } from "@/lib/db";
import type { Quest } from "@/lib/quest";
import { createReport } from "./create";

/**
 * «Спорт-коллаб» for everyone who trained together: one BINGO(collab) report per partner, sharing the
 * author's date, proof files and (for the bot) TelegramLink. Shared by the bot and the website form so
 * the rules are the same on both paths. Per-partner failures (collab already closed, another bingo that
 * day, unknown or inactive user) are returned, never thrown: the author's own report must not depend
 * on a partner's state. Undo works through `linkId` (bot) or the partner deleting the report (site).
 */
export type CollabInput = {
  quest: Quest;
  /** YYYY-MM-DD in the quest timezone. */
  date: string;
  partnerIds: string[];
  comment?: string | null;
  proofUrls?: string[];
  source: ReportSource;
  linkId?: string | null;
};

export type CollabPartnerResult =
  | { userId: string; name: string; ok: true; report: Report }
  | { userId: string; name: string; ok: false; error: string };

export const COLLAB_KEY = "collab";

export async function awardCollab(input: CollabInput): Promise<CollabPartnerResult[]> {
  const ids = [...new Set(input.partnerIds)];
  if (!ids.length) return [];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, isActive: true } });
  const out: CollabPartnerResult[] = [];
  for (const id of ids) {
    const u = users.find((x) => x.id === id);
    if (!u) {
      out.push({ userId: id, name: id, ok: false, error: "не участник квеста" });
      continue;
    }
    if (!u.isActive) {
      out.push({ userId: id, name: u.name, ok: false, error: "участник неактивен" });
      continue;
    }
    const res = await createReport({
      userId: id, quest: input.quest, date: input.date, bingoKey: COLLAB_KEY, comment: input.comment,
      proofUrls: input.proofUrls ?? [], source: input.source, linkId: input.linkId ?? null,
    });
    if (res.ok) out.push({ userId: id, name: u.name, ok: true, report: res.created[0] });
    else out.push({ userId: id, name: u.name, ok: false, error: res.error });
  }
  return out;
}
