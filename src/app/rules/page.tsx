import { BINGO_TASKS } from "@/lib/bingo";

export default function RulesPage() {
  return (
    <article className="prose-sm mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-3xl font-bold">🍂 Операция «Анти-плед» 🎃</h1>
        <p className="mt-1 text-fgm">Сроки: с 3 сентября по 30 ноября</p>
        <p className="mt-3">
          Осень наступила, а вместе с ней — холод, ранние сумерки и непреодолимое желание завернуться
          в плед и не слезать с дивана. Но мы объявляем сезон охоты за Тыковками 🎃!
        </p>
      </header>

      <section className="card p-5">
        <h2 className="text-lg font-bold">1. Базовые активности — 1 день = 1 🎃</h2>
        <p className="mt-2">
          Засчитывается любая физическая нагрузка: бег, тренажёрный зал, йога/растяжка от 15 минут,
          велосипед, плавание, воркаут, домашняя зарядка или зафиксированные 10 000+ шагов.
        </p>
        <p className="mt-2 text-fgm">Формат отчёта: скрин трекера/шагомера, фото с тренировки или короткий видеокружок.</p>
      </section>

      <section className="card p-5">
        <h2 className="text-lg font-bold">2. Стрик 🔥 — серия без пропусков</h2>
        <ul className="mt-2 space-y-1">
          <li>3 дня подряд ➡️ <b>+2 🎃</b></li>
          <li>5 дней подряд ➡️ <b>+5 🎃</b></li>
          <li>7 дней подряд ➡️ <b>+10 🎃</b> и титул «Неуязвимый» на неделю!</li>
        </ul>
        <p className="mt-2 text-sm text-fgm">
          Бонусы суммируются: полная неделя даёт +17 🎃. После 7 дней отсчёт начинается заново.
        </p>
      </section>

      <section className="card p-5">
        <h2 className="text-lg font-bold">3. Осеннее Бинго — +3 🎃 за задание</h2>
        <p className="mt-2 text-sm text-fgm">
          В один день можно закрыть только одно задание. Каждое задание засчитывается один раз за осень
          (9 заданий, максимум +27 🎃).
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-3">
          {BINGO_TASKS.map((t) => (
            <li key={t.key} className="rounded-xl bg-muted p-3">
              <div className="font-semibold">{t.emoji} {t.title}</div>
              <div className="mt-1 text-xs text-fgm">{t.description}</div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card p-5">
        <h2 className="text-lg font-bold">🎁 Финальные номинации (30 ноября)</h2>
        <ul className="mt-2 space-y-1">
          <li>👑 <b>«Повелитель Тыкв»</b> — чемпион по сумме баллов.</li>
          <li>🌋 <b>«Фродо Осеннего Замеса: Пешком до Мордора»</b> — рекордсмен по шагам.</li>
          <li>🎯 <b>«Мастер Бинго»</b> — первый, кто закроет все 9 заданий.</li>
          <li>📸 <b>«Амбассадор Осени»</b> — автор самых атмосферных фото/видео.</li>
        </ul>
      </section>
    </article>
  );
}
