"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getActiveQuest } from "@/lib/quest";
import { saveProofs } from "@/lib/upload";
import { awardCollab, COLLAB_KEY } from "@/lib/reports/collab";
import { createReport } from "@/lib/reports/create";

export type LogState = { error?: string; ok?: boolean } | undefined;

export async function submitReport(_prev: LogState, formData: FormData): Promise<LogState> {
  const user = await requireUser();
  const quest = await getActiveQuest();

  const date = String(formData.get("date") ?? "");
  const activityTypes = formData.getAll("activityType").map(String).filter(Boolean);
  const stepsRaw = String(formData.get("steps") ?? "").replace(/\s/g, "");
  const comment = String(formData.get("comment") ?? "");
  const bingoKey = String(formData.get("bingoKey") ?? "");
  const files = formData.getAll("proof").filter((f): f is File => f instanceof File);
  const partnerIds = bingoKey === COLLAB_KEY ? [...new Set(formData.getAll("partnerId").map(String).filter((id) => id && id !== user.id))] : [];

  const steps = stepsRaw ? Number.parseInt(stepsRaw, 10) : null;
  if (stepsRaw && !Number.isFinite(steps)) return { error: "Шаги: введи число" };

  let proofUrls: string[] = [];
  try {
    proofUrls = await saveProofs(files);
  } catch (e) {
    return { error: (e as Error).message };
  }

  const result = await createReport({ userId: user.id, quest, date, activityTypes, steps, bingoKey, comment, proofUrls, source: "WEB" });
  if (!result.ok) return { error: result.error };

  // «Спорт-коллаб» is credited to the chosen partners too (same rules as the bot; per-partner failures are shown, not fatal).
  const collab = await awardCollab({ quest, date, partnerIds, comment, proofUrls, source: "WEB" });
  const skipped = collab.filter((c) => !c.ok).map((c) => `${c.name}: ${c.ok ? "" : c.error}`);

  revalidatePath("/");
  revalidatePath(`/u/${user.id}`);
  for (const c of collab) if (c.ok) revalidatePath(`/u/${c.userId}`);
  const q = new URLSearchParams({ saved: "1" });
  if (collab.some((c) => c.ok)) q.set("collab", collab.filter((c) => c.ok).map((c) => c.name).join(", "));
  if (skipped.length) q.set("collabSkipped", skipped.join("; "));
  redirect(`/u/${user.id}?${q}`);
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
