/**
 * Re-files a message that was cancelled by mistake with the «🗑 Отменить» button (or the admin
 * page): `undoLink` only deletes the reports and marks the row UNDONE, so the stored extraction,
 * the resolved date and the downloaded proofs are all still there — no LLM call is needed.
 *
 *   npx tsx scripts/bot-restore.ts [linkId] [--apply]
 *
 * Without a linkId the most recently undone message is used. The bot's reply in the chat is edited
 * back from «отменено» to the saved text with its buttons (BOT_MODE=live only).
 */
import "dotenv/config";
import { prisma, TelegramLinkStatus } from "@/lib/db";
import { LIMITS, botConfig } from "@/lib/bot/config";
import { parseStoredExtraction, saveFromExtraction, type Deps } from "@/lib/bot/ingest";
import { OpenAiCompatLlm, RateLimiter } from "@/lib/bot/llm";
import { TelegramApi } from "@/lib/bot/telegram-api";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const linkId = args.find((a) => !a.startsWith("--"));

async function main() {
  const link = linkId
    ? await prisma.telegramLink.findUnique({ where: { id: linkId } })
    : await prisma.telegramLink.findFirst({ where: { status: TelegramLinkStatus.UNDONE }, orderBy: { processedAt: "desc" } });
  if (!link) throw new Error(linkId ? `link ${linkId} not found` : "no undone message to restore");
  if (link.status !== TelegramLinkStatus.UNDONE) throw new Error(`link ${link.id} is ${link.status}, not UNDONE — nothing to restore`);

  const stored = parseStoredExtraction(link.extraction);
  if (!stored?.resolvedDate) throw new Error(`link ${link.id} has no stored extraction — rerun it through the pipeline instead`);
  if (!link.userId) throw new Error(`link ${link.id} has no linked user`);

  console.log(`${link.id}  ${stored.resolvedDate}  «${(stored.text ?? "").replace(/\s+/g, " ").slice(0, 60)}»`);
  if (!apply) {
    console.log("Dry run — ничего не записано. Повтори с --apply.");
    return;
  }

  const cfg = botConfig();
  const deps: Deps = {
    api: new TelegramApi({ token: cfg.token, proxyUrl: cfg.proxyUrl }),
    llm: new OpenAiCompatLlm({ ...cfg.llm, timeoutMs: LIMITS.llmTimeoutMs }),
    limiter: new RateLimiter(LIMITS.llmPerMinute),
    cfg,
  };
  // The collab awards were deleted with everything else, so let saveFromExtraction grant them again.
  const next = await saveFromExtraction(deps, link, { ...stored, collabAwarded: undefined, collabSkipped: undefined }, {
    editMessageId: cfg.mode === "live" ? link.replyMessageId : null,
  });
  console.log(`restored: ${next.savedActivityTypes?.join("+") || "—"}${next.bingoSaved ? " + бинго" : ""}`);
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
