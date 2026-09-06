/** Links a Telegram sender to a website user (spec §2.2 / §6.1). */
import { prisma, type User } from "@/lib/db";
import { normalizeHandle } from "@/lib/telegram";
import type { Mention } from "./extraction";
import type { TgMessage, TgUser } from "./telegram-api";

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
  const existing = await findLinkedUser(from);
  if (existing) return existing;
  return prisma.user.create({
    data: { name: displayName(from), telegramHandle: normalizeHandle(from.username), telegramUserId: String(from.id) },
  });
}

/** Same lookup without the create step: returns null for a sender who has no account yet. */
export async function findLinkedUser(from: TgUser): Promise<User | null> {
  const telegramUserId = String(from.id);
  const byId = await prisma.user.findUnique({ where: { telegramUserId } });
  if (byId) return byId;

  const handle = normalizeHandle(from.username);
  if (!handle) return null;
  const candidates = await prisma.user.findMany({
    where: { telegramUserId: null, telegramHandle: { not: null } },
    orderBy: { createdAt: "asc" },
  });
  const match = candidates.find((u) => normalizeHandle(u.telegramHandle) === handle);
  if (!match) return null;
  return prisma.user.update({ where: { id: match.id }, data: { telegramUserId, telegramHandle: handle } });
}

export type ResolvedMention = Mention & { userId: string | null };

/**
 * Users mentioned in a message, taken from Telegram entities only (`mention` → @handle, `text_mention`
 * → user object), matched to existing accounts the same way `findLinkedUser` does. Nobody is created
 * here: a bare handle has neither a name nor a Telegram id. `participant` is true only for an active
 * account. The author (`excludeUserId`) is dropped, as are duplicates.
 */
export async function resolveMentions(m: TgMessage, excludeUserId: string | null): Promise<ResolvedMention[]> {
  const text = m.text ?? m.caption ?? "";
  const entities = m.text !== undefined ? m.entities ?? [] : m.caption_entities ?? [];
  const out: ResolvedMention[] = [];
  const seen = new Set<string>();
  for (const e of entities) {
    let mention: ResolvedMention | null = null;
    if (e.type === "mention") {
      const handle = normalizeHandle(text.slice(e.offset, e.offset + e.length));
      if (!handle) continue;
      const user = await findUserByHandle(handle);
      mention = { ref: handle, name: user?.name ?? `@${handle}`, participant: !!user?.isActive, userId: user?.id ?? null };
    } else if (e.type === "text_mention" && e.user && !e.user.is_bot) {
      const user = await findLinkedUser(e.user);
      mention = { ref: `tg${e.user.id}`, name: displayName(e.user), participant: !!user?.isActive, userId: user?.id ?? null };
    }
    if (!mention || seen.has(mention.ref)) continue;
    if (mention.userId && mention.userId === excludeUserId) continue;
    seen.add(mention.ref);
    out.push(mention);
  }
  return out;
}

async function findUserByHandle(handle: string): Promise<User | null> {
  const candidates = await prisma.user.findMany({ where: { telegramHandle: { not: null } }, orderBy: { createdAt: "asc" } });
  const matches = candidates.filter((u) => normalizeHandle(u.telegramHandle) === handle);
  return matches.find((u) => u.isActive) ?? matches[0] ?? null;
}
