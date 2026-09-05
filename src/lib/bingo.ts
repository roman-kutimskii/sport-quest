export type BingoKey =
  | "armor" | "leaves" | "night" | "stairs" | "zen"
  | "tea" | "collab" | "weight" | "early";

export const BINGO_TASKS: { key: BingoKey; emoji: string; title: string; description: string }[] = [
  { key: "armor",  emoji: "🧣", title: "В полной броне",       description: "Уличная тренировка или бодрая прогулка в тёплой осенней экипировке (шапка, бафф или перчатки)." },
  { key: "leaves", emoji: "🍂", title: "Листопадный фитнес",   description: "Эстетичное фото/селфи с тренировки среди жёлтых листьев." },
  { key: "night",  emoji: "💡", title: "Ночной дозор",         description: "Вечерняя/ночная тренировка (в темноте или с фонариком)." },
  { key: "stairs", emoji: "🪜", title: "Лифтофобия",           description: "Подъём пешком на 7+ этаж." },
  { key: "zen",    emoji: "🧘‍♂️", title: "Уютный дзен",          description: "Йога или растяжка в тёплых носках / свитере." },
  { key: "tea",    emoji: "☕️", title: "Заслуженный чай",      description: "Фото термоса с горячим напитком после уличной активности." },
  { key: "collab", emoji: "👥", title: "Спорт-коллаб",         description: "Совместная тренировка или прогулка с кем-то из чата." },
  { key: "weight", emoji: "🏋️", title: "Хардкор-утяжелитель",  description: "Тренировка с подручным бытовым грузом (тыква, пакет яблок, канистра, ремонт)." },
  { key: "early",  emoji: "🌅", title: "Ранняя пташка",        description: "Тренировка, начатая до 7:30 утра." },
];

export const BINGO_POINTS = 3;
export const BINGO_KEYS = BINGO_TASKS.map((t) => t.key);
export function isBingoKey(k: string): k is BingoKey {
  return (BINGO_KEYS as string[]).includes(k);
}

export const ACTIVITY_TYPES: { key: string; emoji: string; title: string }[] = [
  { key: "run",      emoji: "🏃", title: "Бег" },
  { key: "gym",      emoji: "🏋️", title: "Тренажёрный зал" },
  { key: "yoga",     emoji: "🧘", title: "Йога / растяжка (15+ мин)" },
  { key: "bike",     emoji: "🚴", title: "Велосипед" },
  { key: "swim",     emoji: "🏊", title: "Плавание" },
  { key: "workout",  emoji: "💪", title: "Воркаут" },
  { key: "home",     emoji: "🏠", title: "Домашняя зарядка" },
  { key: "walk",     emoji: "🚶", title: "Прогулка / 10 000+ шагов" },
  { key: "other",    emoji: "✨", title: "Другое" },
];

/** «🏃 Бег + 🧘 Йога / растяжка (15+ мин)» — label for a report's activity list; falls back to a generic one. */
export function activityLabel(keys: string[]): { emoji: string; title: string } {
  const found = keys.map((k) => ACTIVITY_TYPES.find((t) => t.key === k)).filter((t) => t !== undefined);
  if (!found.length) return { emoji: "✨", title: "Активность" };
  return { emoji: found.map((t) => t.emoji).join(""), title: found.map((t) => t.title).join(" + ") };
}
