"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getActiveQuest } from "@/lib/quest";
import { saveProofs } from "@/lib/upload";
import { createReport } from "@/lib/reports/create";

export type LogState = { error?: string; ok?: boolean } | undefined;

export async function submitReport(_prev: LogState, formData: FormData): Promise<LogState> {
  const user = await requireUser();
  const quest = await getActiveQuest();

  const date = String(formData.get("date") ?? "");
  const activityType = String(formData.get("activityType") ?? "");
  const stepsRaw = String(formData.get("steps") ?? "").replace(/\s/g, "");
  const comment = String(formData.get("comment") ?? "");
  const bingoKey = String(formData.get("bingoKey") ?? "");
  const files = formData.getAll("proof").filter((f): f is File => f instanceof File);

  const steps = stepsRaw ? Number.parseInt(stepsRaw, 10) : null;
  if (stepsRaw && !Number.isFinite(steps)) return { error: "Шаги: введи число" };

  let proofUrls: string[] = [];
  try {
    proofUrls = await saveProofs(files);
  } catch (e) {
    return { error: (e as Error).message };
  }

  const result = await createReport({ userId: user.id, quest, date, activityType, steps, bingoKey, comment, proofUrls, source: "WEB" });
  if (!result.ok) return { error: result.error };

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
