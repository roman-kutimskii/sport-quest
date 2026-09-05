import { prisma, ReportKind, ReportSource, ReportStatus, type Report } from "@/lib/db";
import { ACTIVITY_TYPES, isBingoKey } from "@/lib/bingo";
import { questDates, type Quest } from "@/lib/quest";
import { toDateStr } from "@/lib/scoring/dates";

/**
 * One implementation of «record a report» shared by the website form and the Telegram bot,
 * so validation and the bingo uniqueness rules live in one place.
 */
export type CreateReportInput = {
  userId: string;
  quest: Quest;
  /** YYYY-MM-DD in the quest timezone. */
  date: string;
  activityType?: string | null;
  steps?: number | null;
  bingoKey?: string | null;
  comment?: string | null;
  proofUrls?: string[];
  source?: ReportSource;
  /** TelegramLink id for bot-created reports. */
  linkId?: string | null;
  /**
   * Bot behaviour: when the author already has a non-rejected ACTIVITY report on that date, do not
   * create a second one. Steps are written onto the existing report if it has none; proofs are
   * appended only when that report was also bot-created.
   */
  mergeSameDayActivity?: boolean;
};

export type CreateReportResult =
  | {
      ok: true;
      /** Reports created by this call. */
      created: Report[];
      /** Set when `mergeSameDayActivity` found an existing activity report for the day. */
      existingActivity?: Report;
    }
  | { ok: false; error: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function createReport(input: CreateReportInput): Promise<CreateReportResult> {
  const { quest, userId } = input;
  const { start, end, today } = questDates(quest);
  const date = input.date;
  const activityType = input.activityType || null;
  const bingoKey = input.bingoKey || null;
  const steps = input.steps ?? null;
  const comment = (input.comment ?? "").trim().slice(0, 500) || null;
  const proofUrls = input.proofUrls ?? [];
  const source = input.source ?? ReportSource.WEB;
  const linkId = input.linkId ?? null;

  if (!DATE_RE.test(date)) return { ok: false, error: "Укажи дату" };
  if (date < start || date > end) return { ok: false, error: "Дата вне сроков квеста" };
  if (date > today) return { ok: false, error: "Нельзя отчитаться за будущее 🙂" };
  if (steps !== null && (!Number.isInteger(steps) || steps < 0 || steps > 200000)) return { ok: false, error: "Шаги: введи число" };

  // Steps alone never make a day active: an activity type (e.g. «Прогулка / 10 000+ шагов») must be chosen.
  const hasActivity = Boolean(activityType);
  const stepsOnly = !bingoKey && !activityType;
  if (stepsOnly && !steps) return { ok: false, error: "Выбери тип активности" };
  if (activityType && !ACTIVITY_TYPES.some((t) => t.key === activityType)) return { ok: false, error: "Неизвестный тип активности" };
  if (bingoKey && !isBingoKey(bingoKey)) return { ok: false, error: "Неизвестное задание бинго" };

  const status = quest.autoApprove ? ReportStatus.APPROVED : ReportStatus.PENDING;
  const dateValue = new Date(`${date}T00:00:00.000Z`);

  if (bingoKey) {
    const existing = await prisma.report.findMany({
      where: { userId, questId: quest.id, kind: ReportKind.BINGO, status: { not: ReportStatus.REJECTED } },
      select: { bingoKey: true, date: true },
    });
    if (existing.some((r) => r.bingoKey === bingoKey)) return { ok: false, error: "Это задание бинго уже закрыто (или ждёт проверки)" };
    if (existing.some((r) => toDateStr(r.date) === date)) return { ok: false, error: "В этот день уже есть задание бинго — по правилам только одно в день" };
  }

  let existingActivity: Report | undefined;
  if (input.mergeSameDayActivity && (hasActivity || stepsOnly)) {
    existingActivity = (await prisma.report.findFirst({
      where: { userId, questId: quest.id, kind: ReportKind.ACTIVITY, date: dateValue, status: { not: ReportStatus.REJECTED } },
      orderBy: { createdAt: "asc" },
    })) ?? undefined;
  }

  const created = await prisma.$transaction(async (tx) => {
    const out: Report[] = [];
    if (existingActivity) {
      const patch: { steps?: number; proofUrls?: string[] } = {};
      if (!existingActivity.steps && steps) patch.steps = steps;
      if (existingActivity.source === ReportSource.TELEGRAM && proofUrls.length) {
        patch.proofUrls = [...existingActivity.proofUrls, ...proofUrls.filter((u) => !existingActivity!.proofUrls.includes(u))];
      }
      if (Object.keys(patch).length) existingActivity = await tx.report.update({ where: { id: existingActivity.id }, data: patch });
    } else if (hasActivity) {
      out.push(await tx.report.create({
        data: { userId, questId: quest.id, kind: ReportKind.ACTIVITY, date: dateValue, activityType, steps, comment, proofUrls, status, source, linkId },
      }));
    } else if (stepsOnly) {
      // Steps without an activity: counted in the steps total only.
      out.push(await tx.report.create({
        data: { userId, questId: quest.id, kind: ReportKind.STEPS, date: dateValue, steps, comment, proofUrls, status, source, linkId },
      }));
    }
    if (bingoKey) {
      out.push(await tx.report.create({
        data: {
          userId, questId: quest.id, kind: ReportKind.BINGO, date: dateValue,
          bingoKey, comment, proofUrls, status, source, linkId,
          steps: hasActivity || existingActivity ? null : steps,
        },
      }));
    }
    if (source === ReportSource.WEB && out.length) {
      // The bot announces website reports in the group; bot-created ones already got an in-thread reply.
      await tx.outbox.create({
        data: { kind: "REPORT_CREATED", payload: { userId, reportIds: out.map((r) => r.id) }, dedupeKey: `report:${out[0].id}` },
      });
    }
    return out;
  });

  return { ok: true, created, existingActivity };
}
