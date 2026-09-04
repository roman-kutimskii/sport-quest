import { cache } from "react";
import { prisma } from "@/lib/db";
import { computeScore, type ScoreBreakdown, type ScoringReport } from "@/lib/scoring";
import { toDateStr, todayInTz } from "@/lib/scoring/dates";
import { BINGO_TASKS } from "@/lib/bingo";

export const getActiveQuest = cache(async () => {
  const quest = await prisma.quest.findFirst({ where: { isActive: true }, orderBy: { startDate: "desc" } });
  if (!quest) throw new Error("No active quest. Run `npm run db:seed`.");
  return quest;
});

export type Quest = Awaited<ReturnType<typeof getActiveQuest>>;

export function questDates(quest: Quest) {
  return {
    start: toDateStr(quest.startDate),
    end: toDateStr(quest.endDate),
    today: todayInTz(quest.timezone),
  };
}

type DbReport = {
  id: string; kind: "ACTIVITY" | "BINGO" | "STEPS"; date: Date;
  status: "PENDING" | "APPROVED" | "REJECTED"; bingoKey: string | null; steps: number | null;
};

function toScoring(r: DbReport): ScoringReport {
  return { id: r.id, kind: r.kind, date: toDateStr(r.date), status: r.status, bingoKey: r.bingoKey, steps: r.steps };
}

export type LeaderboardRow = {
  user: { id: string; name: string; avatarEmoji: string; isAdmin: boolean };
  score: ScoreBreakdown;
  rank: number;
  pendingCount: number;
};

export const getLeaderboard = cache(async (quest: Quest): Promise<LeaderboardRow[]> => {
  const { start, end, today } = questDates(quest);
  const users = await prisma.user.findMany({
    where: { isActive: true },
    include: {
      reports: { where: { questId: quest.id } },
      adjustments: { where: { questId: quest.id } },
    },
    orderBy: { name: "asc" },
  });
  const rows = users.map((u) => ({
    user: { id: u.id, name: u.name, avatarEmoji: u.avatarEmoji, isAdmin: u.isAdmin },
    score: computeScore({
      reports: u.reports.map(toScoring),
      adjustments: u.adjustments.map((a) => ({ delta: a.delta })),
      questStart: start, questEnd: end, today,
    }),
    pendingCount: u.reports.filter((r) => r.status === "PENDING").length,
    rank: 0,
  }));
  rows.sort((a, b) => b.score.total - a.score.total || b.score.activeDayCount - a.score.activeDayCount || a.user.name.localeCompare(b.user.name));
  let rank = 0, prev = Number.NaN;
  rows.forEach((r, i) => { if (r.score.total !== prev) { rank = i + 1; prev = r.score.total; } r.rank = rank; });
  return rows;
});

export const getUserBreakdown = cache(async (quest: Quest, userId: string) => {
  const { start, end, today } = questDates(quest);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      reports: { where: { questId: quest.id }, orderBy: [{ date: "desc" }, { createdAt: "desc" }] },
      adjustments: { where: { questId: quest.id }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!user) return null;
  const score = computeScore({
    reports: user.reports.map(toScoring),
    adjustments: user.adjustments.map((a) => ({ delta: a.delta })),
    questStart: start, questEnd: end, today,
  });
  return { user, score, reports: user.reports, adjustments: user.adjustments };
});

export type Nominations = {
  pumpkinLord: LeaderboardRow | null;
  frodo: LeaderboardRow | null;
  bingoMaster: { row: LeaderboardRow; completedOn: string } | null;
};

export function computeNominations(rows: LeaderboardRow[]): Nominations {
  const byTotal = [...rows].sort((a, b) => b.score.total - a.score.total);
  const bySteps = [...rows].sort((a, b) => b.score.totalSteps - a.score.totalSteps);
  const masters = rows
    .filter((r) => r.score.bingoCompleted.length >= BINGO_TASKS.length)
    .map((r) => ({ row: r, completedOn: r.score.bingoCompleted.map((b) => b.date).sort().at(-1)! }))
    .sort((a, b) => a.completedOn.localeCompare(b.completedOn));
  return {
    pumpkinLord: byTotal[0]?.score.total > 0 ? byTotal[0] : null,
    frodo: bySteps[0]?.score.totalSteps > 0 ? bySteps[0] : null,
    bingoMaster: masters[0] ?? null,
  };
}

export type AmbassadorTally = {
  candidate: { id: string; name: string; avatarEmoji: string };
  votes: number;
}[];

/** Votes for «Амбассадор Осени», most-voted first; only active candidates count. */
export const getAmbassadorTally = cache(async (quest: Quest): Promise<AmbassadorTally> => {
  const votes = await prisma.ambassadorVote.findMany({
    where: { questId: quest.id, candidate: { isActive: true } },
    include: { candidate: { select: { id: true, name: true, avatarEmoji: true } } },
  });
  const map = new Map<string, AmbassadorTally[number]>();
  for (const v of votes) {
    const e = map.get(v.candidateId) ?? { candidate: v.candidate, votes: 0 };
    e.votes += 1;
    map.set(v.candidateId, e);
  }
  return [...map.values()].sort((a, b) => b.votes - a.votes || a.candidate.name.localeCompare(b.candidate.name));
});

/** Leader of the poll, or null if nobody voted or the top spot is tied. */
export function ambassadorWinner(tally: AmbassadorTally) {
  if (tally.length === 0) return null;
  if (tally.length > 1 && tally[1].votes === tally[0].votes) return null;
  return tally[0].candidate;
}

export type GalleryItem = { url: string; date: string; reportId: string };
export type GalleryGroup = {
  user: { id: string; name: string; avatarEmoji: string };
  items: GalleryItem[];
};

/** Approved photos/videos their authors opted into the gallery, newest first, grouped by participant (most media first). */
export const getGallery = cache(async (quest: Quest): Promise<GalleryGroup[]> => {
  const reports = await prisma.report.findMany({
    where: { questId: quest.id, status: "APPROVED", galleryUrls: { isEmpty: false }, user: { isActive: true } },
    select: { id: true, date: true, galleryUrls: true, user: { select: { id: true, name: true, avatarEmoji: true } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  const groups = new Map<string, GalleryGroup>();
  const seen = new Set<string>();
  for (const r of reports) {
    const g = groups.get(r.user.id) ?? { user: r.user, items: [] };
    for (const url of r.galleryUrls) {
      if (seen.has(url)) continue;
      seen.add(url);
      g.items.push({ url, date: toDateStr(r.date), reportId: r.id });
    }
    groups.set(r.user.id, g);
  }
  return [...groups.values()].sort((a, b) => b.items.length - a.items.length || a.user.name.localeCompare(b.user.name));
});
