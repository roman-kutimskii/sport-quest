/**
 * File the reports the bot only *recorded* while in BOT_MODE=shadow. Run once when switching to
 * live so the shadow days are not lost:
 *
 *   npx tsx scripts/bot-replay-shadow.ts [--create-accounts] [--skip <linkId,...>] [--apply]
 *
 * Takes TelegramLink rows in status SAVED that have no reports, and files them from the stored
 * extraction (verdict, resolved date, downloaded proofs) — no LLM call, nothing sent to the chat.
 * Senders without an account are created only with --create-accounts (same as the live bot).
 */
import "dotenv/config";
import { prisma, ReportSource, TelegramLinkStatus, type User } from "@/lib/db";
import { ACTIVITY_TYPES, BINGO_TASKS } from "@/lib/bingo";
import { getActiveQuest } from "@/lib/quest";
import { createReport } from "@/lib/reports/create";
import { decide } from "@/lib/bot/extraction";
import { linkSender } from "@/lib/bot/identity";
import { parseStoredExtraction, parseStoredMessage, toJson, type StoredExtraction } from "@/lib/bot/ingest";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const create = args.includes("--create-accounts");
const skip = new Set((args[args.indexOf("--skip") + 1] ?? "").split(",").filter((s) => args.includes("--skip") && s));

async function main() {
  const quest = await getActiveQuest();
  const links = await prisma.telegramLink.findMany({
    where: { status: TelegramLinkStatus.SAVED, reports: { none: {} } },
    orderBy: { messageDate: "asc" },
  });
  console.log(`${links.length} shadow-saved message(s) without reports; mode=${apply ? "APPLY" : "dry run"}`);
  let filed = 0, merged = 0, skipped = 0;

  for (const link of links) {
    if (skip.has(link.id)) { skipped++; continue; }
    const stored = parseStoredExtraction(link.extraction);
    const m = parseStoredMessage(link.update);
    if (!stored?.resolvedDate) { console.log(`  ${link.id}: no stored extraction/date, skipped`); skipped++; continue; }
    // Already handled (live bot or importer) as a merge into an existing day: nothing to file.
    if (stored.dayAlreadyActive !== undefined || stored.savedActivityType !== undefined) continue;

    let user: User | null = link.userId ? await prisma.user.findUnique({ where: { id: link.userId } }) : null;
    const decision = decide(stored, { hasMedia: stored.hasMedia });
    const bingoKey = decision.bingo === "save" ? stored.bingo_key : null;
    const activityType = stored.activity_type ?? (stored.steps || bingoKey ? null : "other");
    const act = ACTIVITY_TYPES.find((t) => t.key === activityType);
    const task = BINGO_TASKS.find((t) => t.key === stored.bingo_key);
    const who = user?.name ?? `${link.fromName ?? link.fromUserId}${create ? " (+новый участник)" : " (без аккаунта — пропуск)"}`;
    console.log(`  ${link.id}  ${stored.resolvedDate}  ${who.padEnd(28)} ${(act ? `${act.emoji} ${act.key}` : "").padEnd(10)} ${stored.steps ?? ""} ${task ? `${task.emoji} ${decision.bingo === "save" ? "явно" : "догадка"}` : ""}  «${(stored.text ?? "").replace(/\s+/g, " ").slice(0, 50)}»`);

    if (!user && (!create || !m?.from)) { skipped++; continue; }
    if (!apply) { filed++; continue; }

    if (!user) {
      user = await linkSender(m!.from!);
      await prisma.telegramLink.update({ where: { id: link.id }, data: { userId: user.id } });
      console.log(`    created participant ${user.name}`);
    }
    const base = { userId: user.id, quest, date: stored.resolvedDate, steps: stored.steps, comment: stored.text, proofUrls: stored.proofUrls, source: ReportSource.TELEGRAM, linkId: link.id, mergeSameDayActivity: true };
    let res = await createReport({ ...base, activityType, bingoKey });
    if (!res.ok && bingoKey) res = await createReport({ ...base, activityType: stored.activity_type ?? (stored.steps ? null : "other"), bingoKey: null });
    if (!res.ok) { console.log(`    FAILED: ${res.error}`); await prisma.telegramLink.update({ where: { id: link.id }, data: { status: TelegramLinkStatus.FAILED, error: res.error } }); skipped++; continue; }
    const dayAlreadyActive = res.existingActivity !== undefined;
    if (dayAlreadyActive) merged++; else filed++;
    const next: StoredExtraction = { ...stored, savedActivityType: activityType, dayAlreadyActive, bingoSaved: res.created.some((r) => r.kind === "BINGO") };
    await prisma.telegramLink.update({ where: { id: link.id }, data: { extraction: toJson(next), error: null } });
  }
  console.log(`\n${apply ? "записано" : "будет записано"}: ${filed}${apply ? `, слито с существующим днём: ${merged}` : ""}, пропущено: ${skipped}${apply ? "" : "\nDry run — ничего не записано. Повтори с --apply."}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
