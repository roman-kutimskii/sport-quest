/**
 * All Russian text rendering for the Telegram bot. Pure functions, plain text (no HTML parse mode).
 */

const RU_MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"] as const;

/** Russian plural: pluralRu(1,"день","дня","дней") → "1 день"; 2 → "2 дня"; 5 → "5 дней"; 11 → "11 дней"; 21 → "21 день". */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  let word = many;
  if (mod100 < 11 || mod100 > 14) {
    if (mod10 === 1) word = one;
    else if (mod10 >= 2 && mod10 <= 4) word = few;
  }
  return `${n} ${word}`;
}

/** 12000 → "12 000" (non-breaking thin group separator is avoided; plain space for Telegram). */
export function fmtSteps(n: number): string {
  const s = String(Math.trunc(Math.abs(n)));
  const grouped = s.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return n < 0 ? `-${grouped}` : grouped;
}

/** "2026-09-04" → "4 сен" */
export function fmtDateShort(d: string): string {
  const [, m, day] = d.split("-").map(Number);
  return `${day} ${RU_MONTHS_SHORT[m - 1] ?? ""}`.trim();
}

const days = (n: number) => pluralRu(n, "день", "дня", "дней");
const streakPart = (n: number) => (n > 0 ? `стрик ${n} 🔥` : null);
const join = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" · ");
const lower = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);

export function renderReplySaved(p: {
  activityTitle?: string | null;
  activityEmoji?: string | null;
  date: string;
  dayAlreadyActive: boolean;
  total: number;
  streak: number;
  steps?: number | null;
  bingoSaved?: { emoji: string; title: string } | null;
  bingoOffer?: { emoji: string; title: string } | null;
  bingoNeedsPhoto?: { title: string } | null;
  videoTooLarge: boolean;
  summary?: string | null;
}): string {
  const emoji = p.activityEmoji ?? (p.steps ? "🚶" : "✅");
  const date = fmtDateShort(p.date);
  const steps = p.steps ? `${fmtSteps(p.steps)} шагов` : null;
  const lines: string[] = [];

  if (p.dayAlreadyActive) {
    lines.push(join([`${emoji} День ${date} уже засчитан ✅`, steps, `${p.total} 🎃`, streakPart(p.streak)]));
  } else if (p.activityTitle) {
    lines.push(join([`${emoji} Записал: ${lower(p.activityTitle)}, ${date}`, "+1 🎃", steps, streakPart(p.streak)]));
  } else if (steps) {
    lines.push(join([`${emoji} Записал: ${steps}, ${date}`, `${p.total} 🎃`, streakPart(p.streak)]));
  } else {
    lines.push(join([`${emoji} Записал за ${date}`, `${p.total} 🎃`, streakPart(p.streak)]));
  }

  if (p.bingoSaved) lines.push(`${p.bingoSaved.emoji} Бинго «${p.bingoSaved.title}» +3 🎃`);
  if (p.bingoOffer) lines.push(`${p.bingoOffer.emoji} Похоже на бинго «${p.bingoOffer.title}» — засчитать?`);
  if (p.bingoNeedsPhoto) lines.push(`🎯 Бинго «${p.bingoNeedsPhoto.title}» нужно с фото — прикрепи его на сайте`);
  if (p.videoTooLarge) lines.push("🎬 Видео больше 20 МБ — прикрепи его на сайте, если нужно");
  return lines.join("\n");
}

export function renderReplyAsk(): string {
  return "Это отчёт о тренировке?";
}

export function renderReplyUndone(): string {
  return "Отменено";
}

export function renderReplyDateError(kind: "future" | "outside"): string {
  return kind === "future"
    ? "🗓 Дата в будущем — так не считаем. Если это про сегодня, напиши без даты."
    : "🗓 Эта дата вне квеста — записать не получится.";
}

export type AnnouncementItem = {
  kind: "ACTIVITY" | "BINGO" | "STEPS";
  activityTitle?: string | null;
  activityEmoji?: string | null;
  bingoTitle?: string | null;
  bingoEmoji?: string | null;
  steps?: number | null;
};

/**
 * One line per website report (or a merged group of them), gender-neutral:
 * "🧘 Маша: йога за 3 сен · 12 🎃 · стрик 3 🔥"
 * "🪜 Петя: бинго «Лифтофобия» (5/9) · 20 🎃"
 */
export function renderAnnouncement(p: {
  name: string;
  items: AnnouncementItem[];
  date: string;
  total: number;
  streak: number;
  bingoDone?: number;
}): string {
  const date = fmtDateShort(p.date);
  const what: string[] = [];
  let emoji: string | null = null;
  let steps: number | null = null;
  for (const it of p.items) {
    if (it.kind === "ACTIVITY") {
      emoji ??= it.activityEmoji ?? null;
      if (it.activityTitle) what.push(lower(it.activityTitle));
    } else if (it.kind === "BINGO") {
      emoji ??= it.bingoEmoji ?? "🎯";
      const n = p.bingoDone != null ? ` (${p.bingoDone}/9)` : "";
      what.push(`бинго «${it.bingoTitle ?? "?"}»${n}`);
    }
    if (it.steps) steps = Math.max(steps ?? 0, it.steps);
  }
  if (!what.length && steps) {
    emoji ??= "🚶";
    what.push(`${fmtSteps(steps)} шагов`);
    steps = null;
  }
  const head = `${emoji ?? "✅"} ${p.name}: ${what.join(" + ") || "отчёт"} за ${date}`;
  return join([head, steps ? `${fmtSteps(steps)} шагов` : null, `${p.total} 🎃`, streakPart(p.streak)]);
}

export function renderMe(p: {
  name: string;
  total: number;
  streak: number;
  bingo: number;
  bingoTotal: number;
  steps: number;
  rank: number;
  activeDays: number;
}): string {
  return [
    `${p.name} — ${p.rank} место · ${p.total} 🎃`,
    `Активных дней: ${p.activeDays} · стрик ${p.streak} 🔥`,
    `Бинго: ${p.bingo}/${p.bingoTotal} 🎯 · шагов: ${fmtSteps(p.steps)}`,
  ].join("\n");
}

export function renderTop(rows: { rank: number; name: string; avatarEmoji: string; total: number; streak: number }[]): string {
  if (!rows.length) return "🏆 Пока никто не отметился — будь первым!";
  const lines = rows.slice(0, 10).map((r) => join([`${r.rank}. ${r.avatarEmoji} ${r.name} — ${r.total} 🎃`, streakPart(r.streak)]));
  return ["🏆 Топ-10", ...lines].join("\n");
}

export function renderHelp(siteUrl?: string): string {
  const site = siteUrl ?? "https://tl-sport.ru";
  return (
    "Я записываю отчёты из постов в группе: напиши про тренировку (например «утром бег, 12 000 шагов»), " +
    "можно с фото или видео — я занесу активность за нужный день и отвечу в ветке. " +
    "Если что-то не так — кнопка «Отменить» под ответом удалит запись, а поправить детали можно на сайте. " +
    "/me — твой счёт, /top — топ-10, /help — это сообщение. " +
    `Таблица, бинго и профиль: ${site}`
  );
}

export function renderPrivateOnlyGroup(): string {
  return "Я работаю только в группе квеста 🎃";
}

export { days as pluralDays };
