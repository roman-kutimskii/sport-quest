import { prisma } from "@/lib/db";
import { getState, STATE_KEYS } from "@/lib/bot/state";

async function check() {
  if ((process.env.BOT_MODE ?? "off") === "off") return;
  if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error("Bot token is missing");
  const lastPoll = await getState<string>(STATE_KEYS.lastPoll);
  const age = Date.now() - Date.parse(lastPoll ?? "");
  if (!Number.isFinite(age) || age < -60_000 || age > 180_000) {
    throw new Error("No successful Telegram poll within 3 minutes; inspect bot/Xray connectivity");
  }
}

check().catch(() => {
  console.error("Bot healthcheck failed: check database, Telegram proxy and recent bot logs");
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
