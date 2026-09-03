export const NOMINATIONS = [
  { key: "pumpkinLord", emoji: "👑", title: "Повелитель Тыкв", subtitle: "чемпион по сумме баллов" },
  { key: "frodo", emoji: "🌋", title: "Фродо Осеннего Замеса", subtitle: "пешком до Мордора: рекордсмен по шагам" },
  { key: "bingoMaster", emoji: "🎯", title: "Мастер Бинго", subtitle: "первый закрыл все 9 заданий" },
  { key: "ambassador", emoji: "📸", title: "Амбассадор Осени", subtitle: "самые атмосферные фото и видео" },
] as const;
export type NominationKey = (typeof NOMINATIONS)[number]["key"];
