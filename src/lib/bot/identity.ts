/** Links a Telegram sender to a website user (spec §2.2 / §6.1). */
import { prisma, type User } from "@/lib/db";
import { normalizeHandle } from "@/lib/telegram";
import type { TgUser } from "./telegram-api";

export function displayName(from: TgUser): string {
  const full = `${from.first_name ?? ""} ${from.last_name ?? ""}`.trim().slice(0, 60);
  return full || from.username || "Участник";
}

/**
 * Order: numeric `telegramUserId` → normalized @username where `telegramUserId` is still null
 * (backfilled here) → create a participant from the Telegram profile.
 * Inactive users are returned as-is; the caller checks `isActive`.
 */
export async function linkSender(from: TgUser): Promise<User> {
  const telegramUserId = String(from.id);
  const byId = await prisma.user.findUnique({ where: { telegramUserId } });
  if (byId) return byId;

  const handle = normalizeHandle(from.username);
  if (handle) {
    const candidates = await prisma.user.findMany({
      where: { telegramUserId: null, telegramHandle: { not: null } },
      orderBy: { createdAt: "asc" },
    });
    const match = candidates.find((u) => normalizeHandle(u.telegramHandle) === handle);
    if (match) {
      return prisma.user.update({ where: { id: match.id }, data: { telegramUserId, telegramHandle: handle } });
    }
  }

  return prisma.user.create({
    data: { name: displayName(from), telegramHandle: handle, telegramUserId },
  });
}
