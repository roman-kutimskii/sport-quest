"use client";

import { useActionState, useState } from "react";
import { isVideoUrl } from "@/lib/media";
import { ACTIVITY_TYPES, BINGO_TASKS } from "@/lib/bingo";
import { submitReport, type LogState } from "./actions";

type Props = { min: string; max: string; today: string; doneBingo: string[]; bingoDates: string[]; activeDays: string[] };

export function LogForm({ min, max, today, doneBingo, bingoDates, activeDays }: Props) {
  const [state, action, pending] = useActionState<LogState, FormData>(submitReport, undefined);
  const [date, setDate] = useState(today);
  const [bingoKey, setBingoKey] = useState("");
  const [showBingo, setShowBingo] = useState(false);
  const [activityType, setActivityType] = useState("");
  const [picked, setPicked] = useState<{ name: string; preview: string | null }[]>([]);

  const dayHasBingo = bingoDates.includes(date);
  const dayActive = activeDays.includes(date);

  return (
    <form action={action} className="card space-y-6 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="date">Дата</label>
          <input id="date" name="date" type="date" className="input" value={date} min={min} max={max} onChange={(e) => setDate(e.target.value)} required />
          {dayActive && <p className="mt-1 text-xs text-ok">В этот день активность уже засчитана — можно добавить бинго.</p>}
        </div>
        <div>
          <label className="label" htmlFor="steps">Шаги (если считаешь)</label>
          <input
            id="steps" name="steps" inputMode="numeric" className="input" placeholder="10 000"
            onChange={(e) => {
              const n = Number.parseInt(e.target.value.replace(/\s/g, ""), 10);
              if (n >= 10000 && !activityType) setActivityType("walk");
            }}
          />
        </div>
      </div>

      {!showBingo && (
        <button type="button" onClick={() => setShowBingo(true)} className="btn-ghost w-full">
          🎯 Добавить задание бинго (+3 🎃)
        </button>
      )}

      {showBingo && (
      <fieldset className="space-y-3">
        <div className="flex items-center justify-between">
          <legend className="label">Задание бинго</legend>
          <button type="button" onClick={() => { setShowBingo(false); setBingoKey(""); }} className="text-xs text-fgm hover:text-fg">Убрать</button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {BINGO_TASKS.map((t) => {
            const done = doneBingo.includes(t.key);
            const sel = bingoKey === t.key;
            return (
              <button
                key={t.key}
                type="button"
                disabled={done || dayHasBingo}
                onClick={() => setBingoKey(t.key)}
                title={done ? "Уже закрыто" : dayHasBingo ? "В этот день уже есть бинго" : t.description}
                className={`rounded-xl border p-2 text-left text-xs transition disabled:opacity-40 ${sel ? "border-accent bg-accent-soft" : "border-line bg-elev hover:bg-muted"}`}
              >
                <div className="text-lg">{t.emoji}</div>
                <div className="font-semibold leading-tight">{t.title}</div>
                {done && <div className="mt-0.5 text-ok">✓ закрыто</div>}
              </button>
            );
          })}
        </div>
        <input type="hidden" name="bingoKey" value={bingoKey} />
        {bingoKey && <p className="text-xs text-fgm">{BINGO_TASKS.find((t) => t.key === bingoKey)?.description}</p>}
        {dayHasBingo && <p className="text-xs text-fgm">На этот день бинго уже записано — по правилам одно задание в день.</p>}
      </fieldset>
      )}

      <fieldset className="space-y-3">
        <legend className="label">Активность</legend>
        {bingoKey && <p className="text-xs text-fgm">День с бинго уже активный (+1 🎃). Тип активности можно не выбирать — он нужен только для статистики.</p>}
        <div className="grid grid-cols-3 gap-2">
          {ACTIVITY_TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActivityType(t.key === activityType ? "" : t.key)}
              className={`rounded-xl border p-2 text-left text-xs transition ${activityType === t.key ? "border-accent bg-accent-soft" : "border-line bg-elev hover:bg-muted"}`}
            >
              <div className="text-lg">{t.emoji}</div>
              <div className="font-semibold leading-tight">{t.title}</div>
            </button>
          ))}
        </div>
        <input type="hidden" name="activityType" value={activityType} />
        {!bingoKey && <p className="text-xs text-fgm">Шаги без выбранной активности сохраняются в общий счёт, но день активным не делают.</p>}
      </fieldset>

      <div>
        <label className="label" htmlFor="proof">Подтверждение: фото, скрины или видео</label>
        <input
          id="proof" name="proof" type="file" accept="image/*,video/*" multiple className="input file:mr-3 file:rounded-lg file:border-0 file:bg-accent-soft file:px-3 file:py-1 file:text-xs file:font-semibold file:text-accent-strong"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []).filter((f) => f.size > 0);
            setPicked(files.map((f) => ({ name: f.name, preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : null })));
          }}
        />
        {picked.length > 0 && (
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {picked.map((f, i) =>
              f.preview ? (
                <img key={`${f.name}-${i}`} src={f.preview} alt="" className="aspect-square w-full rounded-xl object-cover" />
              ) : (
                <div key={`${f.name}-${i}`} className="flex aspect-square w-full items-center justify-center rounded-xl bg-muted text-3xl">{isVideoUrl(f.name) ? "🎬" : "📎"}</div>
              ),
            )}
          </div>
        )}
      </div>

      <div>
        <label className="label" htmlFor="comment">Комментарий</label>
        <textarea id="comment" name="comment" rows={2} className="input" placeholder="5 км по парку, было холодно, но красиво 🍂" />
      </div>

      {state?.error && <p className="rounded-xl bg-danger-soft p-3 text-sm text-danger">{state.error}</p>}

      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "Сохраняю…" : "Забрать тыковку 🎃"}
      </button>
    </form>
  );
}
