"use server";

import { revalidatePath } from "next/cache";
import { prisma, ReportStatus } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getActiveQuest } from "@/lib/quest";

function refreshAll(userId?: string) {
  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/results");
  if (userId) revalidatePath(`/u/${userId}`);
}

export async function reviewReport(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 300);
  const status = decision === "approve" ? ReportStatus.APPROVED : decision === "reject" ? ReportStatus.REJECTED : ReportStatus.PENDING;
  const r = await prisma.report.update({
    where: { id },
    data: { status, reviewedById: admin.id, reviewedAt: new Date(), rejectReason: status === ReportStatus.REJECTED ? reason || "Не подходит под правила" : null },
  });
  refreshAll(r.userId);
}

export async function approveAllPending() {
  const admin = await requireAdmin();
  const quest = await getActiveQuest();
  await prisma.report.updateMany({
    where: { questId: quest.id, status: ReportStatus.PENDING },
    data: { status: ReportStatus.APPROVED, reviewedById: admin.id, reviewedAt: new Date() },
  });
  refreshAll();
}

export async function addAdjustment(formData: FormData) {
  const admin = await requireAdmin();
  const quest = await getActiveQuest();
  const userId = String(formData.get("userId") ?? "");
  const delta = Number.parseInt(String(formData.get("delta") ?? ""), 10);
  const comment = String(formData.get("comment") ?? "").trim().slice(0, 300);
  if (!userId || !Number.isFinite(delta) || delta === 0 || !comment) return;
  await prisma.adjustment.create({ data: { userId, questId: quest.id, delta, comment, createdBy: admin.id } });
  refreshAll(userId);
}

export async function toggleUser(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const field = String(formData.get("field") ?? "");
  if (id === admin.id) return;
  const u = await prisma.user.findUnique({ where: { id } });
  if (!u) return;
  if (field === "isActive") await prisma.user.update({ where: { id }, data: { isActive: !u.isActive } });
  if (field === "isAdmin") await prisma.user.update({ where: { id }, data: { isAdmin: !u.isAdmin } });
  refreshAll(id);
}

export async function updateQuestSettings(formData: FormData) {
  await requireAdmin();
  const quest = await getActiveQuest();
  await prisma.quest.update({
    where: { id: quest.id },
    data: {
      autoApprove: formData.get("autoApprove") === "on",
      resultsPublished: formData.get("resultsPublished") === "on",
      votingOpen: formData.get("votingOpen") === "on",
    },
  });
  refreshAll();
}

export async function setNomination(formData: FormData) {
  await requireAdmin();
  const quest = await getActiveQuest();
  const key = String(formData.get("key") ?? "");
  const userId = String(formData.get("userId") ?? "");
  if (!key) return;
  if (!userId) {
    await prisma.nominationResult.deleteMany({ where: { questId: quest.id, key } });
  } else {
    await prisma.nominationResult.upsert({
      where: { questId_key: { questId: quest.id, key } },
      create: { questId: quest.id, key, userId, isManual: true },
      update: { userId, isManual: true },
    });
  }
  refreshAll();
}
