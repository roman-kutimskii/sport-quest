/** Small key/value store for the worker (`BotState` table): poll offset, health, digest bookkeeping. */
import { prisma, Prisma } from "@/lib/db";

export const STATE_KEYS = {
  offset: "updates.offset",
  lastPoll: "health.lastPollAt",
  lastDigest: "digest.lastPeriod",
  botUsername: "bot.username",
} as const;

export async function getState<T>(key: string): Promise<T | null> {
  const row = await prisma.botState.findUnique({ where: { key } });
  if (!row || row.value === null) return null;
  return row.value as T;
}

export async function setState(key: string, value: unknown): Promise<void> {
  const json = value === undefined || value === null ? Prisma.JsonNull : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);
  await prisma.botState.upsert({ where: { key }, create: { key, value: json }, update: { value: json } });
}
