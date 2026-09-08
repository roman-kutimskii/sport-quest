/**
 * Telegram bot worker (SPEC-TELEGRAM-BOT.md §4). Four loops:
 *   receive  — long-poll getUpdates through the proxy; store messages as TelegramLink rows,
 *              run commands and button callbacks inline;
 *   process  — run the LLM pipeline on RECEIVED rows (≤ LIMITS.llmInFlight, one per author);
 *   outbox   — every 3 s send TEXT rows and DIGEST rows;
 *   schedule — every 60 s enqueue the weekly digest and expire unanswered «Это отчёт?».
 * Run: `npx tsx scripts/bot.ts` (env: BOT_MODE=off|shadow|live, TELEGRAM_BOT_TOKEN, …).
 */
import "dotenv/config";
import { z } from "zod";
import { OutboxStatus, Prisma, TelegramLinkStatus, prisma, type Outbox } from "@/lib/db";
import { getActiveQuest, questDates } from "@/lib/quest";
import { addDays, toDateStr } from "@/lib/scoring/dates";
import { handleCallback } from "@/lib/bot/callbacks";
import { handleCommand } from "@/lib/bot/commands";
import { LIMITS, botConfig } from "@/lib/bot/config";
import { nowInTz, periodKey, weekBounds } from "@/lib/bot/dates";
import { computeDigest, renderDigest, type DigestInput } from "@/lib/bot/digest";
import { errorMessage, processLink, type Deps } from "@/lib/bot/ingest";
import { OpenAiCompatLlm, RateLimiter } from "@/lib/bot/llm";
import { enqueueDigest } from "@/lib/bot/outbox";
import { pickEligible, weekFromPeriodKey, zonedTimeToUtc } from "@/lib/bot/queue";
import { STATE_KEYS, getState, setState } from "@/lib/bot/state";
import { undoLink } from "@/lib/bot/undo";
import { TelegramApi, TelegramApiError, mediaKinds, messageText, parseCommand, type TgMessage, type TgUpdate } from "@/lib/bot/telegram-api";
import { renderPrivateOnlyGroup } from "@/lib/bot/text";

/** Worker-wide dependencies: the shared pipeline deps plus the bot's own username (for `/cmd@bot`). */
type WorkerDeps = Deps & { botUsername?: string };

const log = (msg: string) => console.log(`[bot] ${new Date().toISOString()} ${msg}`);
const logError = (msg: string, e?: unknown) => console.error(`[bot] ${new Date().toISOString()} ${msg}${e !== undefined ? `: ${errorMessage(e)}` : ""}`);

/** Command menu registered with Telegram at startup (spec §2.5). */
const BOT_COMMANDS = [
  { command: "me", description: "Мои тыковки, стрик, бинго и шаги" },
  { command: "top", description: "Топ-10 таблицы лидеров" },
  { command: "help", description: "Что умеет бот" },
];
const ADMIN_COMMANDS = [...BOT_COMMANDS, { command: "digest", description: "Итоги недели сейчас" }];

/**
 * Everyone sees the basic menu; site admins whose Telegram id is known additionally see /digest
 * in the group (Telegram's `chat_member` scope). Admins get their id on their next sign-in.
 */
async function registerCommands(deps: WorkerDeps): Promise<void> {
  const { api, cfg } = deps;
  await api.setMyCommands(BOT_COMMANDS);
  if (!cfg.groupChatId) return;
  const admins = await prisma.user.findMany({ where: { isAdmin: true, isActive: true, telegramUserId: { not: null } }, select: { telegramUserId: true } });
  for (const a of admins) {
    await api
      .setMyCommands(ADMIN_COMMANDS, { type: "chat_member", chat_id: cfg.groupChatId, user_id: Number(a.telegramUserId) })
      .catch((e) => logError(`admin menu for ${a.telegramUserId} failed`, e));
  }
}

/** `error` marking the extra messages of an album, folded into the primary row by the pipeline. */
const ALBUM_SIBLING = "album sibling";

const POLL_TIMEOUT_SEC = 30;
const PROCESS_TICK_MS = 1000;
const OUTBOX_TICK_MS = 3000;
const SCHEDULE_TICK_MS = 60_000;
const MAX_ATTEMPTS = 5;
const SHUTDOWN_GRACE_MS = 45_000;

// ---------- lifecycle ----------

let stopping = false;
const stopController = new AbortController();

/** Sleep that returns early on shutdown. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (stopping) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      stopController.signal.removeEventListener("abort", done);
      resolve();
    }
    stopController.signal.addEventListener("abort", done, { once: true });
  });
}

/** Runs `tick` forever with `intervalMs` pauses; errors are logged and the loop continues. */
async function loop(name: string, intervalMs: number, tick: () => Promise<void>): Promise<void> {
  while (!stopping) {
    try {
      await tick();
    } catch (e) {
      logError(`${name} loop error`, e);
    }
    await sleep(intervalMs);
  }
  log(`${name} loop stopped`);
}

// ---------- receive loop ----------

async function storeMessage(deps: Deps, m: TgMessage): Promise<void> {
  const chatId = String(m.chat.id);
  const isAlbumSibling =
    m.media_group_id !== undefined &&
    (await prisma.telegramLink.findFirst({ where: { chatId, mediaGroupId: m.media_group_id }, select: { id: true } })) !== null;
  try {
    await prisma.telegramLink.create({
      data: {
        chatId,
        messageId: m.message_id,
        threadId: m.message_thread_id ?? null,
        mediaGroupId: m.media_group_id ?? null,
        fromUserId: String(m.from?.id ?? 0),
        fromName: m.from ? `${m.from.first_name} ${m.from.last_name ?? ""}`.trim().slice(0, 100) : null,
        messageDate: new Date(m.date * 1000),
        text: messageText(m),
        mediaKinds: mediaKinds(m),
        update: m as unknown as Prisma.InputJsonValue,
        status: isAlbumSibling ? TelegramLinkStatus.SKIPPED : TelegramLinkStatus.RECEIVED,
        error: isAlbumSibling ? ALBUM_SIBLING : null,
      },
    });
    if (deps.cfg.mode !== "off") log(`stored message ${chatId}/${m.message_id}${isAlbumSibling ? " (album sibling)" : ""}`);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return; // already stored (re-delivered update)
    throw e;
  }
}

/**
 * A caption added by editing a message (Telegram delivers it as `edited_message`). Only the narrow
 * case is reprocessed: the message had NO text when the pipeline ran and the edit gave it one — the
 * bot judged such a message on the photo alone and never saw the words («… + „Лифтофобия“ поднялся
 * на 8 этаж пешком» added a few hours later). An edit of a message that already had text is
 * ignored, so fixing a typo never re-files a report.
 *
 * Reprocessing undoes the first pass (its reports and the bot's reply) and puts the row back to
 * RECEIVED with the new text, so the normal pipeline runs again from scratch.
 */
async function handleEdit(deps: WorkerDeps, m: TgMessage): Promise<void> {
  const text = messageText(m);
  if (!text) return;
  const chatId = String(m.chat.id);
  const edited = await prisma.telegramLink.findUnique({ where: { chatId_messageId: { chatId, messageId: m.message_id } } });
  if (!edited || edited.text) return; // not ours, or it already had a caption

  // The caption may land on any message of an album; the pipeline runs on the primary row.
  const link = edited.error === ALBUM_SIBLING && edited.mediaGroupId
    ? await prisma.telegramLink.findFirst({ where: { chatId, mediaGroupId: edited.mediaGroupId, error: { not: ALBUM_SIBLING } } })
    : edited;
  await prisma.telegramLink.update({ where: { id: edited.id }, data: { text, update: m as unknown as Prisma.InputJsonValue } });
  if (!link || link.status === TelegramLinkStatus.UNDONE) return; // sibling without a primary, or cancelled on purpose
  if (link.status === TelegramLinkStatus.RECEIVED || inFlight.has(link.id)) {
    log(`edited caption on ${chatId}/${m.message_id} (still queued)`);
    return; // not processed yet: the running/queued pipeline will read the new text
  }

  if (deps.cfg.mode === "live") {
    // The first pass acknowledged with either a reply or a reaction; clear whichever it was.
    if (link.replyMessageId) {
      await deps.api.deleteMessage(chatId, link.replyMessageId).catch((e) => logError(`could not delete reply ${link.replyMessageId}`, e));
    } else {
      await deps.api.setMessageReaction({ chatId, messageId: link.messageId, emoji: null }).catch(() => undefined);
    }
  }
  const undone = await undoLink(link.id);
  await prisma.telegramLink.update({
    where: { id: link.id },
    data: { status: TelegramLinkStatus.RECEIVED, error: null, extraction: Prisma.DbNull, llmRaw: null, confidence: null, replyMessageId: null, processedAt: null },
  });
  log(`edited caption on ${chatId}/${m.message_id}: reprocessing link ${link.id} (${undone?.deleted ?? 0} report(s) undone)`);
}

/**
 * «I only work in the group» — said once per person, not once per message: someone who keeps
 * writing to the bot in private should not get an echo every time.
 */
async function notePrivateChat(deps: WorkerDeps, m: TgMessage): Promise<void> {
  const id = String(m.from?.id ?? m.chat.id);
  const told = (await getState<string[]>(STATE_KEYS.privateNoticeSent)) ?? [];
  if (told.includes(id)) return;
  await deps.api.sendMessage({ chatId: m.chat.id, text: renderPrivateOnlyGroup() }).catch((e) => logError("private reply failed", e));
  await setState(STATE_KEYS.privateNoticeSent, [...told, id]);
}

async function handleUpdate(deps: WorkerDeps, u: TgUpdate): Promise<void> {
  const { cfg } = deps;
  if (u.callback_query) return handleCallback(deps, u.callback_query);
  if (u.edited_message) {
    if (cfg.groupChatId !== null && String(u.edited_message.chat.id) === cfg.groupChatId) await handleEdit(deps, u.edited_message);
    return;
  }
  const m = u.message;
  if (!m) return; // anything we did not subscribe to is ignored

  const cmd = parseCommand(m, deps.botUsername);
  if (cmd) return handleCommand(deps, m, cmd);

  if (cfg.groupChatId !== null && String(m.chat.id) !== cfg.groupChatId) {
    if (m.chat.type === "private" && cfg.mode === "live") await notePrivateChat(deps, m);
    return;
  }
  if (cfg.groupChatId === null) return; // group not configured yet: only /id is useful
  await storeMessage(deps, m);
}

async function receiveLoop(deps: WorkerDeps): Promise<void> {
  let offset = (await getState<number>(STATE_KEYS.offset)) ?? undefined;
  while (!stopping) {
    try {
      const updates = await deps.api.getUpdates({ offset, timeoutSec: POLL_TIMEOUT_SEC });
      for (const u of updates) {
        try {
          await handleUpdate(deps, u);
        } catch (e) {
          logError(`update ${u.update_id} failed`, e);
        }
      }
      if (updates.length) {
        offset = updates[updates.length - 1].update_id + 1;
        await setState(STATE_KEYS.offset, offset);
      }
      await setState(STATE_KEYS.lastPoll, new Date().toISOString());
    } catch (e) {
      if (e instanceof TelegramApiError && e.code === 409) {
        logError("getUpdates 409 (another poller running?), waiting 5 s");
        await sleep(5000);
      } else if (e instanceof TelegramApiError && e.code === 429) {
        logError(`getUpdates rate-limited, waiting ${e.retryAfter ?? 3} s`);
        await sleep((e.retryAfter ?? 3) * 1000);
      } else {
        logError("receive loop error", e);
        await sleep(3000);
      }
    }
  }
  log("receive loop stopped");
}

// ---------- process loop ----------

const inFlight = new Map<string, { author: string; promise: Promise<void> }>();

async function processTick(deps: Deps): Promise<void> {
  const capacity = LIMITS.llmInFlight - inFlight.size;
  if (capacity <= 0) return;
  const rows = await prisma.telegramLink.findMany({
    where: { status: TelegramLinkStatus.RECEIVED },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: { id: true, fromUserId: true, createdAt: true },
  });
  const inFlightIds = new Set(inFlight.keys());
  const inFlightAuthors = new Set([...inFlight.values()].map((v) => v.author));
  for (const row of pickEligible(rows, { inFlightIds, inFlightAuthors, capacity, now: new Date(), bufferMs: LIMITS.albumBufferMs })) {
    const promise = processLink(deps, row.id).finally(() => inFlight.delete(row.id));
    inFlight.set(row.id, { author: row.fromUserId, promise });
  }
}

// ---------- outbox drain ----------

const TextPayload = z.object({ text: z.string(), editMessageId: z.number().nullable().optional() });
const ReactionPayload = z.object({ messageId: z.number(), emoji: z.string().nullable() });
const DigestPayload = z.object({ periodKey: z.string(), manual: z.boolean().optional() });

async function markSent(ids: string[], error: string | null = null): Promise<void> {
  await prisma.outbox.updateMany({ where: { id: { in: ids } }, data: { status: OutboxStatus.SENT, sentAt: new Date(), error } });
}

async function markFailed(rows: Outbox[], e: unknown): Promise<void> {
  const error = errorMessage(e).slice(0, 500);
  for (const row of rows) {
    const attempts = row.attempts + 1;
    await prisma.outbox.update({
      where: { id: row.id },
      data: { attempts, error, status: attempts >= MAX_ATTEMPTS ? OutboxStatus.FAILED : OutboxStatus.PENDING },
    });
  }
  logError(`outbox ${rows.map((r) => r.id).join(",")} attempt failed`, e);
}

async function buildDigestInput(deps: Deps, payload: z.infer<typeof DigestPayload>): Promise<DigestInput> {
  const { cfg } = deps;
  const quest = await getActiveQuest();
  const { start, end, today } = questDates(quest);
  const now = new Date();
  const manual = payload.manual ?? false;
  const week = (manual ? null : weekFromPeriodKey(payload.periodKey)) ?? weekBounds(today);
  // Scheduled runs cut off at the configured weekday/hour of that week; manual runs use «now».
  const digestDate = addDays(week.monday, (cfg.digest.weekday + 6) % 7);
  const cutoffAt = manual ? now : zonedTimeToUtc(digestDate, cfg.digest.hour, 0, cfg.timezone);
  const tzNow = nowInTz(cfg.timezone, now);
  const hh = (n: number) => String(n).padStart(2, "0");
  const cutoffLabel = manual ? `${tzNow.date}T${hh(tzNow.hour)}:${hh(tzNow.minute)}` : `${digestDate}T${hh(cfg.digest.hour)}:00`;

  const users = await prisma.user.findMany({
    where: { isActive: true },
    include: {
      reports: { where: { questId: quest.id, createdAt: { lt: cutoffAt } } },
      adjustments: { where: { questId: quest.id, createdAt: { lt: cutoffAt } } },
    },
  });
  return {
    questStart: start,
    questEnd: end,
    weekMonday: week.monday,
    weekSunday: week.sunday,
    cutoff: cutoffLabel,
    today: today < week.sunday ? today : week.sunday,
    users: users.map((u) => ({
      id: u.id, name: u.name, avatarEmoji: u.avatarEmoji, isActive: u.isActive,
      reports: u.reports.map((r) => ({ id: r.id, kind: r.kind, date: toDateStr(r.date), status: r.status, bingoKey: r.bingoKey, steps: r.steps })),
      adjustments: u.adjustments.map((a) => ({ delta: a.delta })),
    })),
  };
}

async function digestComment(deps: Deps, rendered: string): Promise<string | null> {
  try {
    await deps.limiter.acquire();
    const { text } = await deps.llm.complete({
      system:
        "Ты — доброжелательный ведущий спортивного квеста в Telegram-чате. Тебе дают итоги недели. Напиши 1–2 коротких предложения-комментария по-русски: " +
        "подбодри участников, отметь что-то заметное. Не повторяй и не выдумывай числа, не используй списки и заголовки, только текст.",
      user: [{ type: "text", text: rendered }],
    });
    const comment = text.trim().replace(/\s+/g, " ").slice(0, 400);
    return comment || null;
  } catch (e) {
    logError("digest comment failed (ignored)", e);
    return null;
  }
}

async function sendDigest(deps: Deps, row: Outbox, payload: z.infer<typeof DigestPayload>): Promise<void> {
  const input = await buildDigestInput(deps, payload);
  const data = computeDigest(input);
  const siteUrl = deps.cfg.publicUrl;
  let text = renderDigest(data, { siteUrl });
  if (deps.cfg.digest.llmComment) text = renderDigest(data, { siteUrl, comment: await digestComment(deps, text) });
  await deps.api.sendMessage({ chatId: row.chatId ?? deps.cfg.groupChatId!, text, threadId: row.threadId ?? deps.cfg.groupThreadId, disablePreview: true });
  if (!payload.manual) await setState(STATE_KEYS.lastDigest, payload.periodKey);
}

async function sendText(deps: Deps, row: Outbox, payload: z.infer<typeof TextPayload>): Promise<void> {
  const chatId = row.chatId ?? deps.cfg.groupChatId;
  if (!chatId) throw new Error("no chat id");
  if (payload.editMessageId) {
    await deps.api.editMessageText({ chatId, messageId: payload.editMessageId, text: payload.text, replyMarkup: null });
  } else {
    await deps.api.sendMessage({ chatId, text: payload.text, threadId: row.threadId ?? deps.cfg.groupThreadId, disablePreview: true });
  }
}

async function sendReaction(deps: Deps, row: Outbox, payload: z.infer<typeof ReactionPayload>): Promise<void> {
  const chatId = row.chatId ?? deps.cfg.groupChatId;
  if (!chatId) throw new Error("no chat id");
  await deps.api.setMessageReaction({ chatId, messageId: payload.messageId, emoji: payload.emoji });
}

async function outboxTick(deps: Deps): Promise<void> {
  const { cfg } = deps;
  const rows = await prisma.outbox.findMany({
    where: { status: OutboxStatus.PENDING, attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  for (const row of rows) {
    if (cfg.mode !== "live") {
      await markSent([row.id], cfg.mode);
      continue;
    }
    try {
      if (row.kind === "TEXT") {
        await sendText(deps, row, TextPayload.parse(row.payload));
      } else if (row.kind === "DIGEST") {
        await sendDigest(deps, row, DigestPayload.parse(row.payload));
      } else if (row.kind === "REACTION") {
        await sendReaction(deps, row, ReactionPayload.parse(row.payload));
      }
      await markSent([row.id]);
      log(`outbox ${row.kind} ${row.id} sent`);
    } catch (e) {
      await markFailed([row], e);
    }
  }
}

// ---------- scheduler ----------

async function scheduleTick(deps: Deps): Promise<void> {
  const { cfg } = deps;
  const tz = nowInTz(cfg.timezone);
  if (cfg.groupChatId && tz.weekday === cfg.digest.weekday && tz.hour >= cfg.digest.hour) {
    const key = periodKey(tz.date);
    const last = await getState<string>(STATE_KEYS.lastDigest);
    if (last !== key) {
      await enqueueDigest(key, cfg.groupChatId, cfg.groupThreadId);
      if (cfg.mode !== "live") await setState(STATE_KEYS.lastDigest, key); // the drain drops it anyway in shadow
    }
  }

  const expired = await prisma.telegramLink.findMany({
    where: { status: TelegramLinkStatus.ASKED, createdAt: { lt: new Date(Date.now() - LIMITS.askExpiryHours * 3_600_000) } },
    take: 50,
  });
  for (const link of expired) {
    if (link.replyMessageId && cfg.mode === "live") await deps.api.deleteMessage(link.chatId, link.replyMessageId).catch(() => undefined);
    await prisma.telegramLink.update({ where: { id: link.id }, data: { status: TelegramLinkStatus.SKIPPED, error: "ask expired", processedAt: new Date() } });
    log(`link ${link.id}: question expired`);
  }
}

// ---------- main ----------

async function main(): Promise<void> {
  const cfg = botConfig();
  if (cfg.mode === "off" || !cfg.token) {
    log(cfg.mode === "off" ? "BOT_MODE=off — idling (set BOT_MODE=shadow|live to start)" : "TELEGRAM_BOT_TOKEN is not set — idling");
    // A pending promise alone does not keep Node alive (the event loop would drain and the process
    // would exit 0, making `restart: unless-stopped` loop); a timer does. Re-checks nothing: the
    // container is restarted by the deploy when the mode changes.
    const keepAlive = setInterval(() => undefined, 3_600_000);
    const exit = () => { clearInterval(keepAlive); process.exit(0); };
    process.on("SIGTERM", exit);
    process.on("SIGINT", exit);
    await new Promise<void>(() => undefined);
    return;
  }

  const api = new TelegramApi({ token: cfg.token, proxyUrl: cfg.proxyUrl });
  const llm = new OpenAiCompatLlm({ ...cfg.llm, timeoutMs: LIMITS.llmTimeoutMs });
  const deps: WorkerDeps = { api, llm, limiter: new RateLimiter(LIMITS.llmPerMinute), cfg };

  // The proxy can be slow to answer the first request; retry a few times before giving up
  // (a 401 means the token is wrong and retrying is pointless).
  let me;
  for (let attempt = 1; ; attempt++) {
    try {
      me = await api.getMe();
      break;
    } catch (e) {
      const fatal = e instanceof TelegramApiError && e.code === 401;
      logError(`getMe failed (attempt ${attempt}/5) — check TELEGRAM_BOT_TOKEN / TELEGRAM_PROXY_URL`, e);
      if (fatal || attempt >= 5) process.exit(1);
      await sleep(5000);
    }
  }
  deps.botUsername = me.username;
  await setState(STATE_KEYS.botUsername, me.username ?? null);
  await registerCommands(deps).catch((e) => logError("setMyCommands failed (menu may be stale)", e));
  log(`started as @${me.username ?? me.id}, mode=${cfg.mode}, group=${cfg.groupChatId ?? "(not set — use /id)"}${cfg.groupThreadId ? `/${cfg.groupThreadId}` : ""}, llm=${cfg.llm.model}, proxy=${cfg.proxyUrl ? "on" : "off"}`);
  if (!cfg.llm.baseUrl || !cfg.llm.apiKey) logError("LLM_BASE_URL / LLM_API_KEY not set — message classification will fail");

  const loops = [
    receiveLoop(deps),
    loop("process", PROCESS_TICK_MS, () => processTick(deps)),
    loop("outbox", OUTBOX_TICK_MS, () => outboxTick(deps)),
    loop("schedule", SCHEDULE_TICK_MS, () => scheduleTick(deps)),
  ];

  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log(`${signal} received, shutting down (waiting for ${inFlight.size} in-flight link(s))`);
    stopController.abort();
    const timeout = new Promise<void>((r) => setTimeout(r, SHUTDOWN_GRACE_MS));
    Promise.race([Promise.allSettled([...loops, ...[...inFlight.values()].map((v) => v.promise)]), timeout])
      .then(() => prisma.$disconnect())
      .finally(() => {
        log("bye");
        process.exit(0);
      });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  await Promise.all(loops);
}

main().catch((e) => {
  logError("fatal", e);
  process.exit(1);
});
