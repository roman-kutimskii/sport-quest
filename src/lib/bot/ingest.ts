/**
 * Ingestion pipeline for one RECEIVED TelegramLink (spec §2.1 / §5): link the sender, download
 * media, ask the LLM, decide, and either save reports + reply, ask «Это отчёт?», or skip.
 * `saveFromExtraction` is shared with the ✅ callback so a deferred save uses the same code.
 */
import { z } from "zod";
import { prisma, Prisma, ReportKind, ReportSource, ReportStatus, TelegramLinkStatus, type TelegramLink } from "@/lib/db";
import { activityLabel, BINGO_KEYS, BINGO_TASKS } from "@/lib/bingo";
import { awardCollab } from "@/lib/reports/collab";
import { createReport } from "@/lib/reports/create";
import { getActiveQuest, getUserBreakdown, questDates, type Quest } from "@/lib/quest";
import { LIMITS, type BotConfig } from "./config";
import { dateInTz, timeInTz } from "./dates";
import { ExtractionSchema, decide, extractReport, resolveDate, type Extraction } from "./extraction";
import { displayName, findLinkedUser, linkSender, resolveMentions } from "./identity";
import { buildAskKeyboard, buildSavedKeyboard } from "./keyboards";
import type { LlmClient, RateLimiter } from "./llm";
import { saveTelegramMedia, type LlmImage } from "./media";
import { MessageSchema, isForwarded, mediaKinds, messageText, parseCommand, type TelegramApi, type TgMessage } from "./telegram-api";
import { mentionLabel, renderReplyAsk, renderReplyDateError, renderReplySaved } from "./text";

export type Deps = { api: TelegramApi; llm: LlmClient; limiter: RateLimiter; cfg: BotConfig };

/** Max proof files per report (matches the website form). */
const MAX_PROOFS = 10;
const MAX_LLM_RAW = 20_000;

/**
 * What ingest stores in `TelegramLink.extraction`: the validated LLM output plus everything a
 * later button press needs (resolved date, proof urls, what was saved).
 */
export const StoredExtractionSchema = ExtractionSchema.extend({
  resolvedDate: z.string().nullable().default(null),
  proofUrls: z.array(z.string()).default([]),
  hasMedia: z.boolean().default(false),
  videoTooLarge: z.boolean().default(false),
  text: z.string().nullable().default(null),
  /** Set by saveFromExtraction. `savedActivityType` is the pre-array form kept for old rows. */
  savedActivityTypes: z.array(z.string()).optional(),
  savedActivityType: z.string().nullable().optional(),
  dayAlreadyActive: z.boolean().optional(),
  bingoSaved: z.boolean().optional(),
  /** Users mentioned in the message (from entities), with the account they resolved to. */
  mentions: z.array(z.object({ ref: z.string(), name: z.string(), participant: z.boolean(), userId: z.string().nullable() })).default([]),
  /** Set by saveFromExtraction: partners credited with «Спорт-коллаб» and those skipped (with the reason). */
  collabAwarded: z.array(z.object({ userId: z.string(), label: z.string() })).optional(),
  collabSkipped: z.array(z.object({ userId: z.string(), label: z.string(), error: z.string() })).optional(),
});
export type StoredExtraction = z.infer<typeof StoredExtractionSchema>;

export function parseStoredExtraction(v: unknown): StoredExtraction | null {
  // Rows written before the array form carry a single `activity_type`.
  if (v && typeof v === "object" && !("activity_types" in v)) {
    const { activity_type, ...rest } = v as { activity_type?: string | null };
    v = { ...rest, activity_types: activity_type ? [activity_type] : [] };
  }
  const r = StoredExtractionSchema.safeParse(v);
  return r.success ? r.data : null;
}

export function parseStoredMessage(v: unknown): TgMessage | null {
  const r = MessageSchema.safeParse(v);
  return r.success ? r.data : null;
}

export const toJson = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const log = (linkId: string, msg: string) => console.log(`[bot] ${new Date().toISOString()} link ${linkId}: ${msg}`);

/** Runs the pipeline for one link; never throws — failures end up as status FAILED with `error`. */
export async function processLink(deps: Deps, linkId: string): Promise<void> {
  try {
    const link = await prisma.telegramLink.findUnique({ where: { id: linkId } });
    if (!link || link.status !== TelegramLinkStatus.RECEIVED) return;
    await runPipeline(deps, link);
  } catch (e) {
    const error = errorMessage(e).slice(0, 500);
    console.error(`[bot] ${new Date().toISOString()} link ${linkId} FAILED: ${error}`);
    await prisma.telegramLink
      .update({ where: { id: linkId }, data: { status: TelegramLinkStatus.FAILED, error, processedAt: new Date() } })
      .catch((e2) => console.error(`[bot] could not mark link ${linkId} failed: ${errorMessage(e2)}`));
  }
}

async function finish(linkId: string, status: TelegramLinkStatus, error: string | null): Promise<void> {
  await prisma.telegramLink.update({ where: { id: linkId }, data: { status, error, processedAt: new Date() } });
  log(linkId, `${status}${error ? ` (${error})` : ""}`);
}

/** The primary message first, then album siblings (stored as SKIPPED rows with the same mediaGroupId) by message id. */
async function albumMessages(link: TelegramLink, primary: TgMessage): Promise<TgMessage[]> {
  if (!link.mediaGroupId) return [primary];
  const rows = await prisma.telegramLink.findMany({
    where: { chatId: link.chatId, mediaGroupId: link.mediaGroupId, id: { not: link.id } },
    orderBy: { messageId: "asc" },
  });
  const siblings = rows.map((r) => parseStoredMessage(r.update)).filter((m): m is TgMessage => m !== null);
  return [primary, ...siblings].sort((a, b) => a.message_id - b.message_id);
}

async function runPipeline(deps: Deps, link: TelegramLink): Promise<void> {
  const { cfg } = deps;
  const m = parseStoredMessage(link.update);
  if (!m) throw new Error("stored update is not a message");
  if (parseCommand(m)) return finish(link.id, TelegramLinkStatus.SKIPPED, "command");
  if (isForwarded(m)) return finish(link.id, TelegramLinkStatus.SKIPPED, "forwarded");
  if (!m.from || m.from.is_bot) return finish(link.id, TelegramLinkStatus.SKIPPED, "no sender");

  // Existing participants are linked right away; an unknown sender gets an account only if the
  // message turns out to be a report (chatter must not create zero-score leaderboard rows).
  const known = await findLinkedUser(m.from);
  if (known) await prisma.telegramLink.update({ where: { id: link.id }, data: { userId: known.id } });
  if (known && !known.isActive) return finish(link.id, TelegramLinkStatus.SKIPPED, "inactive user");

  const quest = await getActiveQuest();
  const { start, end, today } = questDates(quest);
  const messageDate = dateInTz(m.date, cfg.timezone);
  const messageTime = timeInTz(m.date, cfg.timezone);

  const messages = await albumMessages(link, m);
  const text = messageText(m) ?? messages.map(messageText).find((t): t is string => t !== null) ?? null;
  const mentions = (await Promise.all(messages.map((msg) => resolveMentions(msg, known?.id ?? null)))).flat()
    .filter((x, i, all) => all.findIndex((y) => y.ref === x.ref) === i);
  const kinds = [...new Set(messages.flatMap(mediaKinds))];

  // Media: every message of the album becomes proof (≤ MAX_PROOFS files); the LLM sees at most LIMITS.maxPhotos images.
  let proofUrls: string[] = [];
  let images: LlmImage[] = [];
  let videoTooLarge = false;
  for (const msg of messages) {
    if (proofUrls.length >= MAX_PROOFS) break;
    const r = await saveTelegramMedia(deps.api, msg);
    proofUrls.push(...r.proofUrls);
    images.push(...r.images);
    videoTooLarge ||= r.tooLarge;
  }
  proofUrls = proofUrls.slice(0, MAX_PROOFS);
  images = images.slice(0, LIMITS.maxPhotos);

  const closedBingo = known
    ? await prisma.report.findMany({
        where: { userId: known.id, questId: quest.id, kind: ReportKind.BINGO, status: { not: ReportStatus.REJECTED } },
        select: { bingoKey: true },
      })
    : [];
  const openBingoKeys = BINGO_KEYS.filter((k) => !closedBingo.some((r) => r.bingoKey === k));

  await deps.limiter.acquire();
  const { extraction, raw } = await extractReport(
    deps.llm,
    {
      todayDate: today, messageDate, messageTime, questStart: start, questEnd: end, openBingoKeys,
      senderName: displayName(m.from), text, mediaKinds: kinds, imageCount: images.length, forwarded: false, mentions,
    },
    images,
  );

  const hasMedia = kinds.length > 0;
  const decision = decide(extraction, { hasMedia });
  const resolved = resolveDate(extraction, messageDate, start, end, today);
  const stored: StoredExtraction = {
    ...extraction,
    resolvedDate: "date" in resolved ? resolved.date : null,
    proofUrls, hasMedia, videoTooLarge, text, mentions,
  };
  await prisma.telegramLink.update({
    where: { id: link.id },
    data: { extraction: toJson(stored), llmRaw: raw.slice(0, MAX_LLM_RAW), confidence: extraction.confidence },
  });
  log(link.id, `llm: is_report=${extraction.is_report} conf=${extraction.confidence} → ${decision.action}/${decision.bingo}${extraction.collab_with.length ? ` collab_with=${extraction.collab_with.join(",")}` : ""} «${extraction.summary_ru}»`);

  if (decision.action === "skip") return finish(link.id, TelegramLinkStatus.SKIPPED, null);

  if ("error" in resolved) {
    if (cfg.mode === "live") {
      await deps.api.sendMessage({ chatId: link.chatId, text: renderReplyDateError(resolved.error), threadId: link.threadId, replyTo: link.messageId });
    }
    return finish(link.id, TelegramLinkStatus.SKIPPED, `date:${resolved.error}`);
  }

  if (cfg.mode !== "live") {
    // Shadow: record what would have happened, touch nothing else (no account is created either).
    return finish(link.id, decision.action === "save" ? TelegramLinkStatus.SAVED : TelegramLinkStatus.ASKED, known ? null : "new participant");
  }

  const user = known ?? (await linkSender(m.from));
  if (!known) {
    await prisma.telegramLink.update({ where: { id: link.id }, data: { userId: user.id } });
    log(link.id, `created participant ${user.name} (${user.telegramHandle ?? "-"})`);
  }

  if (decision.action === "ask") {
    const sent = await deps.api.sendMessage({
      chatId: link.chatId, text: renderReplyAsk(), threadId: link.threadId, replyTo: link.messageId, replyMarkup: buildAskKeyboard(link.id),
    });
    await prisma.telegramLink.update({
      where: { id: link.id },
      data: { status: TelegramLinkStatus.ASKED, replyMessageId: sent.message_id, processedAt: new Date(), error: null },
    });
    log(link.id, "ASKED");
    return;
  }

  await saveFromExtraction(deps, { ...link, userId: user.id }, stored);
}

/** A confident report with neither an activity nor steps nor bingo is still «something» — file it as «Другое». */
export function pickActivities(e: Extraction, withBingo: boolean): string[] {
  if (e.activity_types.length) return e.activity_types;
  return e.steps || withBingo ? [] : ["other"];
}

/** What a saved link recorded as its activity list (tolerates rows written before the array form). */
export function savedActivities(e: StoredExtraction): string[] {
  return e.savedActivityTypes ?? (e.savedActivityType ? [e.savedActivityType] : []);
}

export function renderSavedText(
  e: StoredExtraction,
  p: { activityTypes: string[]; total: number; streak: number; dayAlreadyActive: boolean; bingoSaved: string | null; bingoOffer: string | null; bingoNeedsPhoto: boolean },
): string {
  const act = p.activityTypes.length ? activityLabel(p.activityTypes) : undefined;
  const task = (key: string | null) => (key ? BINGO_TASKS.find((t) => t.key === key) : undefined);
  const saved = task(p.bingoSaved);
  const offer = task(p.bingoOffer);
  const needs = p.bingoNeedsPhoto ? task(e.bingo_key) : undefined;
  return renderReplySaved({
    activityTitle: act?.title ?? null,
    activityEmoji: act?.emoji ?? null,
    date: e.resolvedDate ?? "",
    dayAlreadyActive: p.dayAlreadyActive,
    total: p.total,
    streak: p.streak,
    steps: e.steps,
    bingoSaved: saved ? { emoji: saved.emoji, title: saved.title } : null,
    bingoOffer: offer ? { emoji: offer.emoji, title: offer.title } : null,
    bingoNeedsPhoto: needs ? { title: needs.title } : null,
    collabAwarded: e.collabAwarded?.map((c) => c.label) ?? [],
    collabSkipped: e.collabSkipped?.map((c) => ({ label: c.label, error: c.error })) ?? [],
    collabNotParticipants: e.bingo_key === "collab" ? e.mentions.filter((m) => !m.participant).map(mentionLabel) : [],
    collabNoPhoto: !e.hasMedia && e.collab_with.length > 0,
    videoTooLarge: e.videoTooLarge,
    summary: e.summary_ru,
  });
}

/** Partners named in `collab_with` that resolved to an account. */
export function collabPartners(e: StoredExtraction): { userId: string; label: string }[] {
  return e.mentions
    .filter((m) => m.userId && m.participant && e.collab_with.includes(m.ref))
    .map((m) => ({ userId: m.userId!, label: mentionLabel(m) }));
}

export async function userScore(quest: Quest, userId: string): Promise<{ total: number; streak: number; bingoDone: number }> {
  const b = await getUserBreakdown(quest, userId);
  return { total: b?.score.total ?? 0, streak: b?.score.currentStreak ?? 0, bingoDone: b?.score.bingoCompleted.length ?? 0 };
}

/**
 * The «save» step: creates the report(s) from a stored extraction, replies (or edits the question
 * message when `editMessageId` is given) and marks the link SAVED. Throws on hard failures.
 */
export async function saveFromExtraction(
  deps: Deps,
  link: TelegramLink,
  stored: StoredExtraction,
  opts: { editMessageId?: number | null } = {},
): Promise<StoredExtraction> {
  const userId = link.userId;
  if (!userId) throw new Error("link has no linked user");
  if (!stored.resolvedDate) throw new Error("no resolved date");
  const quest = await getActiveQuest();
  const decision = decide(stored, { hasMedia: stored.hasMedia });

  const base = {
    userId, quest, date: stored.resolvedDate, steps: stored.steps, comment: stored.text, proofUrls: stored.proofUrls,
    source: ReportSource.TELEGRAM, linkId: link.id, mergeSameDayActivity: true,
  };
  let bingoKey = decision.bingo === "save" ? stored.bingo_key : null;
  let activityTypes = pickActivities(stored, bingoKey !== null);
  let res = await createReport({ ...base, activityTypes, bingoKey });
  if (!res.ok && bingoKey) {
    // Bingo already closed / another bingo that day: keep the activity, drop the bingo silently.
    bingoKey = null;
    activityTypes = pickActivities(stored, false);
    res = await createReport({ ...base, activityTypes, bingoKey: null });
  }
  if (!res.ok) throw new Error(`createReport: ${res.error}`);

  const dayAlreadyActive = res.existingActivity !== undefined;
  const bingoOffer = !bingoKey && decision.bingo === "offer" ? stored.bingo_key : null;

  // «Спорт-коллаб» for the mentioned partners: independent of the author's own bingo, but the rules
  // still require a photo. Never awarded twice for one link (a ✅ after «ask» goes through here once).
  let collab: Pick<StoredExtraction, "collabAwarded" | "collabSkipped"> = {};
  const partners = stored.collabAwarded ? [] : collabPartners(stored);
  if (partners.length && stored.hasMedia) {
    const results = await awardCollab({
      quest, date: stored.resolvedDate, partnerIds: partners.map((p) => p.userId), comment: stored.text, proofUrls: stored.proofUrls,
      source: ReportSource.TELEGRAM, linkId: link.id,
    });
    const label = (id: string) => partners.find((p) => p.userId === id)?.label ?? id;
    collab = {
      collabAwarded: results.filter((r) => r.ok).map((r) => ({ userId: r.userId, label: label(r.userId) })),
      collabSkipped: results.filter((r) => !r.ok).map((r) => ({ userId: r.userId, label: label(r.userId), error: r.ok ? "" : r.error })),
    };
    log(link.id, `collab: awarded ${collab.collabAwarded!.length}, skipped ${collab.collabSkipped!.length}`);
  }
  stored = { ...stored, ...collab };

  const { total, streak } = await userScore(quest, userId);
  const text = renderSavedText(stored, {
    activityTypes, total, streak, dayAlreadyActive, bingoSaved: bingoKey, bingoOffer, bingoNeedsPhoto: decision.bingoNeedsPhotoNote,
  });
  const replyMarkup = buildSavedKeyboard({ linkId: link.id, userId, publicUrl: deps.cfg.publicUrl, offerBingo: bingoOffer !== null });

  let replyMessageId: number;
  if (opts.editMessageId) {
    await deps.api.editMessageText({ chatId: link.chatId, messageId: opts.editMessageId, text, replyMarkup });
    replyMessageId = opts.editMessageId;
  } else {
    const sent = await deps.api.sendMessage({ chatId: link.chatId, text, threadId: link.threadId, replyTo: link.messageId, replyMarkup });
    replyMessageId = sent.message_id;
  }

  const next: StoredExtraction = { ...stored, savedActivityTypes: activityTypes, dayAlreadyActive, bingoSaved: bingoKey !== null };
  await prisma.telegramLink.update({
    where: { id: link.id },
    data: { status: TelegramLinkStatus.SAVED, replyMessageId, extraction: toJson(next), processedAt: new Date(), error: null },
  });
  log(link.id, `SAVED ${res.created.length + (collab.collabAwarded?.length ?? 0)} report(s)${dayAlreadyActive ? " (day already active)" : ""}${bingoKey ? ` bingo=${bingoKey}` : ""}`);
  return next;
}
