/**
 * Re-files a message that was cancelled by mistake with the «🗑 Отменить» button (or the admin
 * page): `undoLink` only deletes the reports and marks the row UNDONE, so the stored extraction,
 * the resolved date and the downloaded proofs are all still there — no LLM call is needed.
 *
 *   npx tsx scripts/bot-restore.ts [linkId] [--apply]
 *
 * Without a linkId the most recently undone message is used. The bot's reply in the chat is edited
 * back from «отменено» to the saved text with its buttons; this needs BOT_MODE=live and the same
 * TELEGRAM_* env the worker uses, so the script refuses to touch the database without them.
 *
 * Re-runnable: the reports are filed before the Telegram call, so a failed send would otherwise
 * leave them behind with the row still UNDONE. Any reports already attached to the link are
 * therefore deleted first, and a second run restores from the stored extraction just like the first.
 */
import "dotenv/config";
import { prisma, TelegramLinkStatus } from "@/lib/db";
import { LIMITS, botConfig } from "@/lib/bot/config";
import { parseStoredExtraction, saveFromExtraction, type Deps } from "@/lib/bot/ingest";
import { OpenAiCompatLlm, RateLimiter } from "@/lib/bot/llm";
import { TelegramApi } from "@/lib/bot/telegram-api";
import { undoLink } from "@/lib/bot/undo";

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

  // Checked before anything is written: restoring the reports but failing to fix the reply in the
  // chat leaves the message looking cancelled while the points are back.
  const cfg = botConfig();
  if (!cfg.token) throw new Error("TELEGRAM_BOT_TOKEN is not set — the reply in the chat could not be restored");
  if (cfg.mode !== "live") throw new Error(`BOT_MODE=${cfg.mode} — restoring only makes sense against the live chat`);
  if (!link.replyMessageId) throw new Error(`link ${link.id} has no reply message to edit`);

  const orphans = await prisma.report.count({ where: { linkId: link.id } });
  if (orphans) console.log(`${orphans} report(s) left by an interrupted run will be re-filed`);

  if (!apply) {
    console.log("Dry run — ничего не записано. Повтори с --apply.");
    return;
  }

  const deps: Deps = {
    api: new TelegramApi({ token: cfg.token, proxyUrl: cfg.proxyUrl }),
    llm: new OpenAiCompatLlm({ ...cfg.llm, timeoutMs: LIMITS.llmTimeoutMs }),
    limiter: new RateLimiter(LIMITS.llmPerMinute),
    cfg,
  };
  // Clear whatever an interrupted run left behind, so the re-file cannot double-count.
  if (orphans) await undoLink(link.id);

  const next = await saveFromExtraction(deps, link, stored, { editMessageId: link.replyMessageId });
  console.log(`restored: ${next.savedActivityTypes?.join("+") || "—"}${next.bingoSaved ? " + бинго" : ""}`);
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
