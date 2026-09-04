"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { isSingleEmoji } from "@/lib/avatars";

export type ProfileState = { error?: string; ok?: boolean } | undefined;

export async function updateProfile(_prev: ProfileState, formData: FormData): Promise<ProfileState> {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
  const avatarEmoji = String(formData.get("avatarEmoji") ?? "").trim();

  if (name.length < 2) return { error: "Имя: минимум 2 символа" };
  if (!isSingleEmoji(avatarEmoji)) return { error: "Иконка: нужен ровно один эмодзи" };

  await prisma.user.update({ where: { id: user.id }, data: { name, avatarEmoji } });

  revalidatePath("/", "layout");
  revalidatePath(`/u/${user.id}`);
  revalidatePath("/results");
  return { ok: true };
}
