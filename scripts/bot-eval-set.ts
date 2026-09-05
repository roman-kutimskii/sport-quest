/**
 * Eval set for the LLM extraction prompt (see SPEC-TELEGRAM-BOT.md §9). Run with `npm run bot:eval`.
 * Every case is text-only (no images); `expect` lists what a correct extraction must satisfy.
 * Message date for all cases: 2026-09-10 (Thursday) 19:00 Moscow; quest 2026-09-03 … 2026-11-30.
 */
export type EvalCase = {
  text: string;
  mediaKinds?: ("photo" | "video")[];
  expect: {
    is_report: boolean;
    /** Expected band when is_report: "save" (≥0.75) | "ask" (0.45–0.75); omitted → any. */
    band?: "save" | "ask";
    activity_types?: string[];
    steps?: number | null;
    date?: string;
    bingo_key?: string | null;
    bingo_explicit?: boolean;
  };
};

export const MESSAGE_DATE = "2026-09-10";
export const MESSAGE_TIME = "19:00";
export const OPEN_BINGO = ["armor", "leaves", "night", "stairs", "zen", "tea", "collab", "weight", "early"];

export const EVAL_SET: EvalCase[] = [
  // clear reports
  { text: "Пробежал 5 км 🍂", mediaKinds: ["photo"], expect: { is_report: true, band: "save", activity_types: ["run"], date: "2026-09-10" } },
  { text: "Сегодня зал, ноги 💪", expect: { is_report: true, band: "save", activity_types: ["gym"] } },
  { text: "Йога 30 минут перед сном", expect: { is_report: true, band: "save", activity_types: ["yoga"] } },
  { text: "Проехал на веле 20 км до работы и обратно", expect: { is_report: true, band: "save", activity_types: ["bike"] } },
  { text: "Бассейн, 1 км", expect: { is_report: true, band: "save", activity_types: ["swim"] } },
  { text: "Зарядка дома сделана ✅", expect: { is_report: true, band: "save", activity_types: ["home"] } },
  { text: "Турники во дворе, 5 подходов подтягиваний", expect: { is_report: true, band: "save", activity_types: ["workout"] } },
  { text: "Прогулка 12 000 шагов", expect: { is_report: true, band: "save", activity_types: ["walk"], steps: 12000 } },
  { text: "14 532 шага за день", expect: { is_report: true, steps: 14532 } },
  { text: "12к шагов сегодня", expect: { is_report: true, steps: 12000 } },
  { text: "Отчёт: бег 6 км, 11 200 шагов", expect: { is_report: true, band: "save", activity_types: ["run"], steps: 11200 } },
  { text: "", mediaKinds: ["photo"], expect: { is_report: true } }, // photo without caption — any band, the model decides from the image
  { text: "Час в тренажёрке", mediaKinds: ["photo"], expect: { is_report: true, band: "save", activity_types: ["gym"] } },
  { text: "Сходила на пилатес", expect: { is_report: true, band: "save" } },
  { text: "Погоняли в футбол с ребятами", expect: { is_report: true, band: "save" } },

  // relative dates
  { text: "Вчера пробежала 3 км, забыла написать", expect: { is_report: true, activity_types: ["run"], date: "2026-09-09" } },
  { text: "Позавчера был зал", expect: { is_report: true, activity_types: ["gym"], date: "2026-09-08" } },
  { text: "В понедельник бегал 5 км", expect: { is_report: true, activity_types: ["run"], date: "2026-09-07" } },
  { text: "Утром сделал зарядку", expect: { is_report: true, activity_types: ["home"], date: "2026-09-10" } },
  { text: "8 сентября — велик 15 км", expect: { is_report: true, activity_types: ["bike"], date: "2026-09-08" } },

  // explicit bingo
  { text: "Лифтофобия: 9 этаж пешком 🪜", mediaKinds: ["photo"], expect: { is_report: true, bingo_key: "stairs", bingo_explicit: true } },
  { text: "Бинго «Ранняя пташка»: пробежка в 6:40", mediaKinds: ["photo"], expect: { is_report: true, activity_types: ["run"], bingo_key: "early", bingo_explicit: true } },
  { text: "Йога в тёплых носках — уютный дзен 🧘", mediaKinds: ["photo"], expect: { is_report: true, activity_types: ["yoga"], bingo_key: "zen", bingo_explicit: true } },
  { text: "Заслуженный чай после пробежки ☕️", mediaKinds: ["photo"], expect: { is_report: true, bingo_key: "tea", bingo_explicit: true } },
  { text: "Спорт-коллаб с Машей: прогулка 8 км", mediaKinds: ["photo"], expect: { is_report: true, activity_types: ["walk"], bingo_key: "collab", bingo_explicit: true } },
  { text: "Пробежка в темноте с фонариком — ночной дозор 💡", mediaKinds: ["photo"], expect: { is_report: true, activity_types: ["run"], bingo_key: "night", bingo_explicit: true } },
  { text: "Тренировка с тыквой вместо гири 🎃", mediaKinds: ["photo"], expect: { is_report: true, bingo_key: "weight" } },

  // not reports: chatter, encouragement, plans, questions
  { text: "Молодцы! 🔥", expect: { is_report: false } },
  { text: "Завтра побегу, обещаю", expect: { is_report: false } },
  { text: "Кто-нибудь идёт в зал в субботу?", expect: { is_report: false } },
  { text: "Какая же красивая осень сегодня", expect: { is_report: false } },
  { text: "Как считаются баллы за стрик?", expect: { is_report: false } },
  { text: "Огонь, так держать 💪", expect: { is_report: false } },
  { text: "Всем привет, я новенький", expect: { is_report: false } },
  { text: "Планирую с понедельника йогу по утрам", expect: { is_report: false } },
  { text: "Ох, болит спина после вчерашнего", expect: { is_report: false } },
  { text: "Ужин после тренировки 🍝", mediaKinds: ["photo"], expect: { is_report: false } },
  { text: "Кто хочет со мной на пробежку в 7 утра?", expect: { is_report: false } },
  { text: "Ссылка на правила: tl-sport.ru/rules", expect: { is_report: false } },
  { text: "Хочу на плавание записаться, посоветуйте бассейн", expect: { is_report: false } },

  // future / edge dates
  { text: "В воскресенье пробегу 10 км", expect: { is_report: false } },
  { text: "1 сентября пробежал 5 км", expect: { is_report: true, activity_types: ["run"], date: "2026-09-01" } }, // pre-quest → the worker drops it
];
