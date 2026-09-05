/** LLM extraction: prompt building, output validation, threshold decisions (spec §5). */
import { z } from "zod";
import { ACTIVITY_TYPES, BINGO_TASKS } from "@/lib/bingo";
import { formatRuDate } from "@/lib/scoring/dates";
import { THRESHOLDS } from "./config";
import type { LlmClient, LlmPart } from "./llm";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const ExtractionSchema = z.object({
  is_report: z.boolean(),
  confidence: z.number().min(0).max(1),
  date: z.string().regex(DATE_RE).nullable(),
  activity_types: z.array(z.string()),
  steps: z.number().int().nullable(),
  bingo_key: z.string().nullable(),
  bingo_explicit: z.boolean(),
  bingo_confidence: z.number().min(0).max(1),
  summary_ru: z.string().max(80),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

/** Tolerant pre-normalisation of typical LLM slips (numeric strings, "null" strings, missing optional fields). */
function normalizeRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = { ...(raw as Record<string, unknown>) };
  const nullish = (v: unknown) => v === undefined || v === "" || v === "null" || v === "none" || v === "None";
  for (const k of ["date", "steps", "bingo_key"]) if (nullish(o[k])) o[k] = null;
  // Older stored extractions (and an LLM that ignores the schema) carry a single `activity_type`.
  if (o.activity_types === undefined) o.activity_types = o.activity_type;
  delete o.activity_type;
  if (o.activity_types === null || nullish(o.activity_types)) o.activity_types = [];
  else if (typeof o.activity_types === "string") o.activity_types = o.activity_types.split(/[,+]/);
  if (typeof o.steps === "string" && /^\d+$/.test(o.steps.replace(/[\s_]/g, ""))) o.steps = Number(o.steps.replace(/[\s_]/g, ""));
  if (typeof o.steps === "number" && !Number.isInteger(o.steps)) o.steps = Math.round(o.steps);
  for (const k of ["confidence", "bingo_confidence"]) if (typeof o[k] === "string" && o[k] !== "") o[k] = Number(o[k]);
  if (o.bingo_explicit === undefined) o.bingo_explicit = false;
  if (o.bingo_confidence === undefined) o.bingo_confidence = 0;
  if (o.summary_ru === undefined || o.summary_ru === null) o.summary_ru = "";
  if (typeof o.summary_ru === "string" && o.summary_ru.length > 80) o.summary_ru = o.summary_ru.slice(0, 80);
  return o;
}

/**
 * Zod parse plus enum checks against code constants: unknown `activity_types` entries dropped; `bingo_key`
 * not among the author's open tasks → null (with `bingo_explicit=false`, `bingo_confidence=0`).
 * Throws ZodError on structural failure.
 */
export function coerceExtraction(raw: unknown, openBingoKeys: string[]): Extraction {
  const e = ExtractionSchema.parse(normalizeRaw(raw));
  const activity_types = [...new Set(e.activity_types.map((a) => a.trim().toLowerCase()).filter((a) => ACTIVITY_TYPES.some((t) => t.key === a)))];
  const bingo = e.bingo_key?.trim().toLowerCase() ?? null;
  const bingoOk = bingo !== null && openBingoKeys.includes(bingo);
  return {
    ...e,
    activity_types,
    steps: e.steps !== null && e.steps >= 0 ? e.steps : null,
    bingo_key: bingoOk ? bingo : null,
    bingo_explicit: bingoOk ? e.bingo_explicit : false,
    bingo_confidence: bingoOk ? e.bingo_confidence : 0,
    summary_ru: e.summary_ru.trim(),
  };
}

/** Strips ```json fences and extracts the first {...} object; throws if nothing parses. */
export function parseJsonLoose(text: string): unknown {
  let s = text.trim();
  const fence = /^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/.exec(s);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    /* fall through */
  }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in LLM output");
  return JSON.parse(s.slice(start, end + 1));
}

export type PromptContext = {
  todayDate: string;
  messageDate: string;
  /** HH:MM Moscow */
  messageTime: string;
  questStart: string;
  questEnd: string;
  openBingoKeys: string[];
  senderName: string;
  text: string | null;
  mediaKinds: string[];
  imageCount: number;
  forwarded: boolean;
};

const MEDIA_RU: Record<string, string> = { photo: "фото", video: "видео", document: "файл" };

export function buildSystemPrompt(ctx: PromptContext): string {
  const activities = ACTIVITY_TYPES.map((t) => `- "${t.key}" — ${t.title}`).join("\n");
  const open = new Set(ctx.openBingoKeys);
  const bingo = BINGO_TASKS.map((t) => `- "${t.key}" — «${t.title}»: ${t.description}${open.has(t.key) ? "" : " [уже закрыто — НЕ использовать]"}`).join("\n");
  const allowedBingo = ctx.openBingoKeys.length ? ctx.openBingoKeys.map((k) => `"${k}"`).join(", ") : "(нет открытых заданий — bingo_key всегда null)";
  const ymd = (d: string) => `${d} (${formatRuDate(d)})`;

  return `Ты — помощник спортивного квеста в Telegram-чате. Тебе дают одно сообщение участника (текст и/или фото). Определи, является ли оно ОТЧЁТОМ О ВЫПОЛНЕННОЙ АКТИВНОСТИ автора, и извлеки поля. Отвечай ТОЛЬКО одним JSON-объектом без пояснений.

Контекст:
- Сегодня: ${ymd(ctx.todayDate)}. Сообщение отправлено ${ymd(ctx.messageDate)} в ${ctx.messageTime} (Europe/Moscow).
- Квест идёт с ${ctx.questStart} по ${ctx.questEnd}.

Типы активности (activity_types):
${activities}
Если автор сделал несколько разных активностей за день («утром бег, вечером йога») — перечисли все ключи; иначе один. Правило: «прогулка» или «10 000+ шагов» → "walk"; силовая в зале → "gym"; турники/отжимания → "workout"; зарядка дома → "home"; спорт, которого нет в списке (лыжи, теннис, футбол, танцы, скалолазание…) → "other".

Задания бинго (bingo_key) — засчитываются только по фото:
${bingo}
Разрешённые значения bingo_key для этого автора: ${allowedBingo}. Любое другое → null.

Схема ответа (все ключи обязательны):
{
  "is_report": boolean,        // автор СДЕЛАЛ активность (прошлое или настоящее время)
  "confidence": number,        // 0..1 — уверенность, что это отчёт
  "date": "YYYY-MM-DD" | null, // дата активности; null = дата сообщения
  "activity_types": string[],  // ключи из списка выше (обычно один; несколько, если было несколько активностей); [] если ничего
  "steps": integer | null,     // количество шагов, только если явно названо числом
  "bingo_key": string | null,  // ключ открытого задания бинго или null
  "bingo_explicit": boolean,   // автор сам НАЗВАЛ задание в тексте
  "bingo_confidence": number,  // 0..1 — уверенность, что задание выполнено
  "summary_ru": string         // краткое описание по-русски, до 80 символов
}

Правила:
1. is_report = true только для уже выполненной активности самого автора: «пробежал 5 км», «сегодня зал», «12 000 шагов», фото с тренировки. НЕ отчёт: планы и намерения («завтра побегу», «собираюсь в зал»), поддержка и реакции («молодцы!», «красава», «🔥»), вопросы, обсуждение правил, шутки, еда, пересланные чужие сообщения, отчёты о чужих тренировках.
2. confidence: ≥ 0.9 — явный отчёт с деталями; 0.75–0.9 — отчёт, но без части деталей (например, фото без подписи, где видна тренировка); 0.45–0.75 — неясно, отчёт ли это (нужно уточнить у автора); < 0.45 — скорее не отчёт. Если не уверен — покажи это через confidence, не выдумывай.
3. date: если дата не названа — null (будет взята дата сообщения). Относительные слова считай от ДАТЫ СООБЩЕНИЯ, а не от сегодня: «вчера» = день до даты сообщения, «позавчера» = два дня до, «в субботу»/«во вторник» = ближайший такой день ДО или В дату сообщения, «утром»/«вечером» = дата сообщения. Явно названная дата («3 сентября») важнее относительных слов. Если сообщение отправлено ночью (00:00–04:00) и автор пишет про «сегодня вечером»/«только что», ставь предыдущий день.
4. steps: только если в тексте есть число шагов («12 000 шагов», «15к шагов» → 15000, «шаги: 8543»). Километры, минуты, этажи — не шаги. Если шагов нет — null. Шаги могут быть отчётом сами по себе (activity_types может быть пустым).
5. bingo_key: ставь только если содержание сообщения соответствует одному из открытых заданий. bingo_explicit = true только когда автор сам называет задание словами (название, ключевые слова: «лифтофобия», «7 этаж пешком», «бинго: ранняя пташка», «ночной дозор», «листопад», «термос»). Если задание лишь угадывается по фото — bingo_explicit = false и bingo_confidence отражает степень уверенности. Без фото/видео бинго не засчитывается, но поле всё равно заполняй.
6. summary_ru: короткая фраза вида «бег 5 км в парке», «зал, ноги», «12 000 шагов». Для не-отчёта — «не отчёт» или краткая суть.
7. Если сообщение переслано (forwarded) — is_report = false.`;
}

export function buildUserParts(ctx: PromptContext, images: { mime: string; data: Buffer }[]): LlmPart[] {
  const media = ctx.mediaKinds.length ? ctx.mediaKinds.map((k) => MEDIA_RU[k] ?? k).join(", ") : "нет";
  const lines = [
    `Отправитель: ${ctx.senderName}`,
    `Дата сообщения: ${ctx.messageDate} ${ctx.messageTime}`,
    `Вложения: ${media}${ctx.imageCount ? ` (изображений приложено: ${ctx.imageCount})` : ""}`,
    `Переслано: ${ctx.forwarded ? "да" : "нет"}`,
    `Текст сообщения:`,
    ctx.text ? `"""\n${ctx.text}\n"""` : "(без текста)",
  ];
  const parts: LlmPart[] = [{ type: "text", text: lines.join("\n") }];
  for (const img of images) parts.push({ type: "image", mime: img.mime, data: img.data });
  return parts;
}

function describeError(e: unknown): string {
  if (e instanceof z.ZodError) return e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
  return e instanceof Error ? e.message : String(e);
}

/** Calls the LLM and validates the output; one retry with the validation error appended to the user message. */
export async function extractReport(llm: LlmClient, ctx: PromptContext, images: { mime: string; data: Buffer }[]): Promise<{ extraction: Extraction; raw: string }> {
  const system = buildSystemPrompt(ctx);
  const user = buildUserParts(ctx, images);
  let lastError: unknown;
  let parts = user;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text } = await llm.complete({ system, user: parts, json: true });
    try {
      return { extraction: coerceExtraction(parseJsonLoose(text), ctx.openBingoKeys), raw: text };
    } catch (e) {
      lastError = e;
      parts = [
        ...user,
        { type: "text", text: `Предыдущий ответ не прошёл проверку: ${describeError(e)}. Ответ был:\n${text.slice(0, 1000)}\nВерни корректный JSON строго по схеме.` },
      ];
    }
  }
  throw new Error(`LLM output failed validation twice: ${describeError(lastError)}`);
}

export type Decision = { action: "save" | "ask" | "skip"; bingo: "save" | "offer" | "none"; bingoNeedsPhotoNote: boolean };

/** Threshold decisions per spec §5.3. */
export function decide(e: Extraction, opts: { hasMedia: boolean }): Decision {
  let action: Decision["action"] = "skip";
  if (e.is_report && e.confidence >= THRESHOLDS.save) action = "save";
  else if (e.is_report && e.confidence >= THRESHOLDS.ask) action = "ask";

  const candidate = e.bingo_key !== null && e.bingo_confidence >= THRESHOLDS.bingoOffer;
  let bingo: Decision["bingo"] = "none";
  if (e.bingo_key !== null && opts.hasMedia) {
    if (e.bingo_explicit && e.bingo_confidence >= THRESHOLDS.bingoExplicit) bingo = "save";
    else if (e.bingo_confidence >= THRESHOLDS.bingoOffer) bingo = "offer";
  }
  return { action, bingo, bingoNeedsPhotoNote: candidate && !opts.hasMedia };
}

/** Resolves the report date: explicit date or message date; rejects future and out-of-quest dates. */
export function resolveDate(e: Extraction, messageDate: string, questStart: string, questEnd: string, today: string): { date: string } | { error: "future" | "outside" } {
  const date = e.date ?? messageDate;
  if (date > today) return { error: "future" };
  if (date < questStart || date > questEnd) return { error: "outside" };
  return { date };
}
