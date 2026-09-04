"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma, ReportKind, ReportStatus } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getActiveQuest, questDates } from "@/lib/quest";
import { isBingoKey, ACTIVITY_TYPES } from "@/lib/bingo";
import { saveProofs } from "@/lib/upload";
import { toDateStr } from "@/lib/scoring/dates";

export type LogState = { error?: string; ok?: boolean } | undefined;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function submitReport(_prev: LogState, formData: FormData): Promise<LogState> {
  const user = await requireUser();
  const quest = await getActiveQuest();
  const { start, end, today } = questDates(quest);

  const date = String(formData.get("date") ?? "");
  const activityType = String(formData.get("activityType") ?? "");
  const stepsRaw = String(formData.get("steps") ?? "").replace(/\s/g, "");
  const comment = String(formData.get("comment") ?? "").trim().slice(0, 500);
  const bingoKey = String(formData.get("bingoKey") ?? "");
  const withActivity = formData.get("withActivity") === "on";
  const files = formData.getAll("proof").filter((f): f is File => f instanceof File);

  if (!DATE_RE.test(date)) return { error: "Укажи дату" };
  if (date < start || date > end) return { error: "Дата вне сроков квеста" };
  if (date > today) return { error: "Нельзя отчитаться за будущее 🙂" };

  const steps = stepsRaw ? Number.parseInt(stepsRaw, 10) : null;
  if (stepsRaw && (!Number.isFinite(steps) || steps! < 0 || steps! > 200000)) return { error: "Шаги: введи число" };

  // Steps alone never make a day active: an activity type (e.g. «Прогулка / 10 000+ шагов») must be chosen.
  const hasActivity = (withActivity || !bingoKey) && Boolean(activityType);
  const stepsOnly = !bingoKey && !activityType;
  if (stepsOnly && !steps) return { error: "Выбери тип активности" };
  if (activityType && !ACTIVITY_TYPES.some((t) => t.key === activityType)) return { error: "Неизвестный тип активности" };
  if (bingoKey && !isBingoKey(bingoKey)) return { error: "Неизвестное задание бинго" };

  let proofUrls: string[] = [];
  try {
    proofUrls = await saveProofs(files);
  } catch (e) {
    return { error: (e as Error).message };
  }

  const status = quest.autoApprove ? ReportStatus.APPROVED : ReportStatus.PENDING;
  const dateValue = new Date(`${date}T00:00:00.000Z`);

  if (bingoKey) {
    const existing = await prisma.report.findMany({
      where: { userId: user.id, questId: quest.id, kind: ReportKind.BINGO, status: { not: ReportStatus.REJECTED } },
      select: { bingoKey: true, date: true },
    });
    if (existing.some((r) => r.bingoKey === bingoKey)) return { error: "Это задание бинго уже закрыто (или ждёт проверки)" };
    if (existing.some((r) => toDateStr(r.date) === date)) return { error: "В этот день уже есть задание бинго — по правилам только одно в день" };
  }

  await prisma.$transaction(async (tx) => {
    if (hasActivity) {
      await tx.report.create({
        data: {
          userId: user.id, questId: quest.id, kind: ReportKind.ACTIVITY, date: dateValue,
          activityType, steps, comment: comment || null, proofUrls, status,
        },
      });
    } else if (stepsOnly) {
      // Steps without an activity: counted in the steps total only.
      await tx.report.create({
        data: { userId: user.id, questId: quest.id, kind: ReportKind.STEPS, date: dateValue, steps, comment: comment || null, proofUrls, status },
      });
    }
    if (bingoKey) {
      await tx.report.create({
        data: {
          userId: user.id, questId: quest.id, kind: ReportKind.BINGO, date: dateValue,
          bingoKey, comment: comment || null, proofUrls, status,
          steps: hasActivity ? null : steps,
        },
      });
    }
  });

  revalidatePath("/");
  revalidatePath(`/u/${user.id}`);
  redirect(`/u/${user.id}?saved=1`);
}

export async function deleteOwnReport(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const report = await prisma.report.findUnique({ where: { id } });
  if (!report || report.userId !== user.id) return;
  await prisma.report.delete({ where: { id } });
  revalidatePath("/");
  revalidatePath(`/u/${user.id}`);
}

/** Flip whether one proof of the caller's own report is shown in the gallery. */
export async function toggleGalleryProof(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const url = String(formData.get("url") ?? "");
  const report = await prisma.report.findUnique({ where: { id } });
  if (!report || report.userId !== user.id || !report.proofUrls.includes(url)) return;
  const galleryUrls = report.galleryUrls.includes(url)
    ? report.galleryUrls.filter((u) => u !== url)
    : report.proofUrls.filter((u) => u === url || report.galleryUrls.includes(u));
  await prisma.report.update({ where: { id }, data: { galleryUrls } });
  revalidatePath(`/u/${user.id}`);
  revalidatePath("/gallery");
  revalidatePath("/vote");
}
