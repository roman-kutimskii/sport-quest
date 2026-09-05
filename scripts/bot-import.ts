/**
 * Import group history from a Telegram Desktop export (Export chat history → JSON, with photos)
 * through the bot pipeline, without sending anything to the chat.
 *
 *   npx tsx scripts/bot-import.ts --dir ~/Downloads/ChatExport_2026-09-05 [--since 2026-09-03] [--until <ISO>]
 *                                 [--map user123=<userId> ...] [--create-accounts] [--skip <msgId,msgId>] [--apply]
 *
 * Dry run by default: classifies every message (results cached in <dir>/import-cache.json so
 * --apply does not call the LLM again) and prints what would be filed next to what the site
 * already has for that person and day. --apply writes TelegramLink rows and reports.
 *
 * Rules: messages the bot already saw (same chat/message id) are skipped; accounts are never
 * created unless --create-accounts is given, and then only for a sender whose message is filed as a
 * report, exactly like the live bot (unmatched senders are listed, map them with --map); the «ask» band is recorded but not
 * filed; bingo is filed only when named in the text; same-day merge rules of createReport apply.
 */
import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma, ReportKind, ReportSource, ReportStatus, TelegramLinkStatus, type User } from "@/lib/db";
import { BINGO_KEYS, BINGO_TASKS, ACTIVITY_TYPES } from "@/lib/bingo";
import { getActiveQuest, questDates } from "@/lib/quest";
import { createReport } from "@/lib/reports/create";
import { saveProofBytes } from "@/lib/upload";
import { LIMITS, botConfig } from "@/lib/bot/config";
import { dateInTz, timeInTz } from "@/lib/bot/dates";
import { ExtractionSchema, decide, extractReport, resolveDate, type Extraction } from "@/lib/bot/extraction";
import { exportChatId, exportMediaKind, exportText, exportUnixTime, groupExportMessages, localToUnix, matchSender, senderId, type ExportFile } from "@/lib/bot/import";
import { OpenAiCompatLlm, RateLimiter } from "@/lib/bot/llm";
import { toJson, type StoredExtraction } from "@/lib/bot/ingest";

type Args = { dir: string; since: string; until: string | null; apply: boolean; create: boolean; map: Record<string, string>; skip: Set<number> };

function parseArgs(argv: string[]): Args {
  const a: Args = { dir: "", since: "", until: null, apply: false, create: false, map: {}, skip: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--dir") a.dir = argv[++i];
    else if (v === "--since") a.since = argv[++i];
    else if (v === "--until") a.until = argv[++i];
    else if (v === "--apply") a.apply = true;
    else if (v === "--create-accounts") a.create = true;
    else if (v === "--skip") {
      for (const id of (argv[++i] ?? "").split(",")) if (id.trim()) a.skip.add(Number(id));
    }
    else if (v === "--map") {
      const m = /^user(\d+)=(.+)$/.exec(argv[++i] ?? "");
      if (!m) throw new Error("--map expects user<telegram id>=<site user id>");
      a.map[m[1]] = m[2];
    } else throw new Error(`unknown argument ${v}`);
  }
  if (!a.dir) throw new Error("--dir <export folder> is required");
  return a;
}

const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".mp4": "video/mp4", ".mov": "video/quicktime" };
const MAX_LLM_IMAGE_BYTES = 2 * 1024 * 1024;

type Cached = { extraction: Extraction; raw: string };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = botConfig();
  const quest = await getActiveQuest();
  const { start, end, today } = questDates(quest);
  const since = args.since || start;

  const file = JSON.parse(await readFile(path.join(args.dir, "result.json"), "utf8")) as ExportFile;
  const chatId = exportChatId(file.id);
  if (cfg.groupChatId && chatId !== cfg.groupChatId) throw new Error(`export is for chat ${chatId}, but TELEGRAM_GROUP_CHAT_ID=${cfg.groupChatId}`);

  // Default cutoff: the first message the live bot stored — everything after it was already handled.
  const firstSeen = await prisma.telegramLink.findFirst({ where: { chatId }, orderBy: { messageDate: "asc" }, select: { messageDate: true } });
  const untilUnix = args.until ? Math.floor(Date.parse(args.until) / 1000) : firstSeen ? Math.floor(firstSeen.messageDate.getTime() / 1000) : Math.floor(Date.now() / 1000);
  const sinceUnix = localToUnix(`${since}T00:00:00`, cfg.timezone);

  const groups = groupExportMessages(file.messages, { sinceUnix, untilUnix });
  const seen = new Set((await prisma.telegramLink.findMany({ where: { chatId }, select: { messageId: true } })).map((l) => l.messageId));
  const users = await prisma.user.findMany();
  const cachePath = path.join(args.dir, "import-cache.json");
  const cache: Record<string, Cached> = JSON.parse(await readFile(cachePath, "utf8").catch(() => "{}"));
  const llm = new OpenAiCompatLlm({ ...cfg.llm, timeoutMs: LIMITS.llmTimeoutMs });
  const limiter = new RateLimiter(LIMITS.llmPerMinute);

  console.log(`chat ${chatId} «${file.name ?? ""}»: ${groups.length} message group(s) from ${since} until ${new Date(untilUnix * 1000).toISOString()}; ${seen.size} already seen by the bot; mode=${args.apply ? "APPLY" : "dry run"}`);

  const unknown = new Map<string, string>();
  const rows: string[] = [];
  let filed = 0, merged = 0, asked = 0, skipped = 0, created = 0;

  for (const group of groups) {
    const primary = group.find((m) => exportText(m)) ?? group[0];
    if (group.some((m) => seen.has(m.id) || args.skip.has(m.id))) continue;
    if (group.some((m) => m.forwarded_from)) continue;
    const sender = matchSender(primary, users, args.map);
    const tgId = senderId(primary)!;
    if (!sender && !args.create) { unknown.set(tgId, primary.from ?? "?"); continue; }
    let user: User | null = sender?.user ?? null;
    if (user && !user.isActive) continue;

    const unix = exportUnixTime(primary);
    const messageDate = dateInTz(unix, cfg.timezone);
    const text = exportText(primary);
    const kinds = [...new Set(group.map(exportMediaKind).filter((k): k is "photo" | "video" | "document" => k !== null))];

    // Media: photos from the export folder become proof + LLM images; videos become proof only.
    const proofFiles: { data: Buffer; mime: string }[] = [];
    const images: { data: Buffer; mime: string }[] = [];
    for (const m of group) {
      const rel = m.photo ?? m.file;
      if (!rel) continue;
      const mime = m.mime_type ?? MIME[path.extname(rel).toLowerCase()] ?? "";
      if (!mime.startsWith("image/") && !mime.startsWith("video/")) continue;
      const data = await readFile(path.join(args.dir, rel)).catch(() => null);
      if (!data) { console.warn(`  missing media file ${rel} (message ${m.id})`); continue; }
      proofFiles.push({ data, mime });
      if (mime.startsWith("image/") && data.length <= MAX_LLM_IMAGE_BYTES && images.length < LIMITS.maxPhotos) images.push({ data, mime });
    }

    const closed = user ? await prisma.report.findMany({ where: { userId: user.id, questId: quest.id, kind: ReportKind.BINGO, status: { not: ReportStatus.REJECTED } }, select: { bingoKey: true } }) : [];
    const openBingoKeys = BINGO_KEYS.filter((k) => !closed.some((r) => r.bingoKey === k));

    const key = String(primary.id);
    let cached = cache[key];
    if (!cached || !ExtractionSchema.safeParse(cached.extraction).success) {
      await limiter.acquire();
      cached = await extractReport(llm, {
        todayDate: today, messageDate, messageTime: timeInTz(unix, cfg.timezone), questStart: start, questEnd: end, openBingoKeys,
        senderName: primary.from ?? user?.name ?? "Участник", text, mediaKinds: kinds, imageCount: images.length, forwarded: false,
      }, images);
      cache[key] = cached;
      await writeFile(cachePath, JSON.stringify(cache, null, 1));
    }
    const { extraction, raw } = cached;
    const hasMedia = kinds.length > 0;
    const decision = decide(extraction, { hasMedia });
    const resolved = resolveDate(extraction, messageDate, start, end, today);
    const date = "date" in resolved ? resolved.date : null;

    const existing = date && user
      ? await prisma.report.findMany({ where: { userId: user.id, questId: quest.id, date: new Date(`${date}T00:00:00.000Z`), status: { not: ReportStatus.REJECTED } } })
      : [];
    const existingLabel = existing.map((r) => (r.kind === "BINGO" ? `бинго ${r.bingoKey}` : r.kind === "STEPS" ? `шаги ${r.steps}` : `${r.activityType}${r.steps ? ` ${r.steps}` : ""}`) + (r.source === "WEB" ? " (сайт)" : " (бот)")).join(", ");
    const act = ACTIVITY_TYPES.find((t) => t.key === extraction.activity_type);
    const bingo = BINGO_TASKS.find((t) => t.key === extraction.bingo_key);
    const bingoLabel = bingo ? `${bingo.emoji} ${decision.bingo === "save" ? "явно" : decision.bingo === "offer" ? "догадка" : "без фото"}` : "";

    let action: string;
    let status: TelegramLinkStatus;
    let error: string | null = null;
    if (decision.action === "skip") { action = "—"; status = TelegramLinkStatus.SKIPPED; skipped++; }
    else if ("error" in resolved) { action = `дата: ${resolved.error}`; status = TelegramLinkStatus.SKIPPED; error = `date:${resolved.error}`; skipped++; }
    else if (decision.action === "ask") { action = "неясно — вручную"; status = TelegramLinkStatus.SKIPPED; error = "import: uncertain, not filed"; asked++; }
    else if (existing.some((r) => r.kind === "ACTIVITY" || (r.kind === "BINGO"))) { action = "день уже есть → слить"; status = TelegramLinkStatus.SAVED; merged++; }
    else { action = user ? "записать" : "записать + новый участник"; status = TelegramLinkStatus.SAVED; filed++; if (!user) created++; }
    if (decision.bingo === "offer") error = [error, "import: bingo guess not applied"].filter(Boolean).join("; ");
    if (!user && status !== TelegramLinkStatus.SAVED) { if (!args.apply) unknown.set(tgId, `${primary.from ?? "?"} (не отчёт)`); continue; }

    rows.push([
      String(primary.id).padStart(5),
      `${messageDate} ${timeInTz(unix, cfg.timezone)}`.padEnd(17),
      `${sender?.how === "name" ? "≈" : sender ? "" : "+"}${user?.name ?? primary.from ?? "?"}`.slice(0, 22).padEnd(23),
      (extraction.is_report ? `${extraction.confidence.toFixed(2)}` : "нет").padEnd(5),
      `${act ? `${act.emoji} ${act.key}` : ""}${extraction.steps ? ` ${extraction.steps}` : ""}`.padEnd(14),
      (date ?? "").padEnd(11),
      bingoLabel.padEnd(14),
      action.padEnd(22),
      existingLabel ? `уже: ${existingLabel}` : "",
      `  «${(text ?? "").replace(/\s+/g, " ").slice(0, 50)}»`,
    ].join(" "));

    if (!args.apply) continue;

    if (!user) {
      // Same as the live bot: an account from the Telegram profile; the later sign-in attaches to it by Telegram id.
      user = await prisma.user.create({ data: { name: (primary.from ?? "Участник").trim().slice(0, 60) || "Участник", telegramUserId: tgId } });
      users.push(user);
      console.log(`  created participant ${user.name} (${tgId})`);
    }
    const uid = user.id;

    const proofUrls: string[] = [];
    if (status === TelegramLinkStatus.SAVED) for (const f of proofFiles) proofUrls.push(await saveProofBytes(f.data, f.mime));
    const stored: StoredExtraction = { ...extraction, resolvedDate: date, proofUrls, hasMedia, videoTooLarge: false, text };
    const link = await prisma.telegramLink.create({
      data: {
        chatId, messageId: primary.id, fromUserId: tgId, fromName: primary.from ?? null, userId: uid,
        messageDate: new Date(unix * 1000), text, mediaKinds: kinds, mediaGroupId: group.length > 1 ? `import:${primary.id}` : null,
        update: toJson({ message_id: primary.id, date: unix, chat: { id: Number(chatId), type: "supergroup" }, from: { id: Number(tgId), is_bot: false, first_name: primary.from ?? "" }, text, imported: true }),
        status, extraction: toJson(stored), llmRaw: raw.slice(0, 20_000), confidence: extraction.confidence, error, processedAt: new Date(),
      },
    });
    for (const m of group) if (m.id !== primary.id) {
      await prisma.telegramLink.create({ data: { chatId, messageId: m.id, fromUserId: tgId, fromName: primary.from ?? null, userId: uid, messageDate: new Date(exportUnixTime(m) * 1000), mediaKinds: [exportMediaKind(m) ?? "document"], mediaGroupId: `import:${primary.id}`, status: TelegramLinkStatus.SKIPPED, error: "album sibling", processedAt: new Date() } }).catch(() => undefined);
    }
    if (status !== TelegramLinkStatus.SAVED || !date) continue;

    const bingoKey = decision.bingo === "save" ? extraction.bingo_key : null;
    const activityType = extraction.activity_type ?? (extraction.steps || bingoKey ? null : "other");
    let res = await createReport({ userId: uid, quest, date, activityType, steps: extraction.steps, bingoKey, comment: text, proofUrls, source: ReportSource.TELEGRAM, linkId: link.id, mergeSameDayActivity: true });
    if (!res.ok && bingoKey) res = await createReport({ userId: uid, quest, date, activityType: extraction.activity_type ?? (extraction.steps ? null : "other"), steps: extraction.steps, bingoKey: null, comment: text, proofUrls, source: ReportSource.TELEGRAM, linkId: link.id, mergeSameDayActivity: true });
    if (!res.ok) {
      await prisma.telegramLink.update({ where: { id: link.id }, data: { status: TelegramLinkStatus.FAILED, error: res.error } });
      console.warn(`  message ${primary.id}: ${res.error}`);
      continue;
    }
    const next: StoredExtraction = { ...stored, savedActivityType: activityType, dayAlreadyActive: res.existingActivity !== undefined, bingoSaved: bingoKey !== null && res.created.some((r) => r.kind === "BINGO") };
    await prisma.telegramLink.update({ where: { id: link.id }, data: { extraction: toJson(next) } });
  }

  console.log(["id".padStart(5), "дата и время".padEnd(17), "участник".padEnd(23), "conf".padEnd(5), "тип/шаги".padEnd(14), "дата отчёта".padEnd(11), "бинго".padEnd(14), "действие".padEnd(22), "на сайте"].join(" "));
  console.log(rows.join("\n"));
  console.log(`\nзаписать: ${filed}${created ? ` (из них с новым участником: ${created})` : ""}, слить с существующим днём: ${merged}, неясно (вручную): ${asked}, не отчёт/пропуск: ${skipped}`);
  if (unknown.size) {
    console.log(`\nНе сопоставлены с участниками (${args.create ? "не отчёты, аккаунт не нужен" : "сообщения пропущены; задай --map user<id>=<id участника на сайте> или --create-accounts"}):`);
    for (const [id, name] of unknown) console.log(`  user${id}  ${name}`);
    console.log(`Участники без Telegram id: ${users.filter((u) => !u.telegramUserId).map((u) => `${u.name}=${u.id}`).join(", ")}`);
  }
  if (!args.apply) console.log(`\nDry run — ничего не записано. Повтори с --apply.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
