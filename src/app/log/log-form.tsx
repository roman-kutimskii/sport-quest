"use client";

import { useActionState, useState } from "react";
import { ACTIVITY_TYPES, BINGO_TASKS } from "@/lib/bingo";
import { submitReport, type LogState } from "./actions";

type Props = { min: string; max: string; today: string; doneBingo: string[]; bingoDates: string[]; activeDays: string[] };

export function LogForm({ min, max, today, doneBingo, bingoDates, activeDays }: Props) {
  const [state, action, pending] = useActionState<LogState, FormData>(submitReport, undefined);
  const [date, setDate] = useState(today);
  const [bingoKey, setBingoKey] = useState("");
  const [withActivity, setWithActivity] = useState(true);
  const [activityType, setActivityType] = useState("");
  const [previews, setPreviews] = useState<string[]>([]);

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
          <input id="steps" name="steps" inputMode="numeric" className="input" placeholder="10 000" />
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="label">Задание бинго (необязательно)</legend>
        <div className="grid grid-cols-3 gap-2">
          <button type="button" onClick={() => setBingoKey("")} className={`rounded-xl border p-2 text-left text-xs transition ${bingoKey === "" ? "border-accent bg-accent-soft" : "border-line bg-elev hover:bg-muted"}`}>
            <div className="text-lg">🚫</div>
            <div className="font-semibold">Без бинго</div>
          </button>
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
        {bingoKey && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="withActivity" checked={withActivity} onChange={(e) => setWithActivity(e.target.checked)} className="h-4 w-4 accent-accent" />
            Это же и моя активность за день (+1 🎃)
          </label>
        )}
      </fieldset>

      {(withActivity || !bingoKey) && (
        <fieldset className="space-y-3">
          <legend className="label">Активность</legend>
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
          <div>
            <label className="label" htmlFor="durationMin">Длительность, мин</label>
            <input id="durationMin" name="durationMin" inputMode="numeric" className="input" placeholder="30" />
          </div>
        </fieldset>
      )}

      <div>
        <label className="label" htmlFor="proof">Подтверждение: фото, скрины или видео</label>
        <input
          id="proof" name="proof" type="file" accept="image/*,video/*" multiple className="input file:mr-3 file:rounded-lg file:border-0 file:bg-accent-soft file:px-3 file:py-1 file:text-xs file:font-semibold file:text-accent-strong"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            setPreviews(files.filter((f) => f.type.startsWith("image/")).map((f) => URL.createObjectURL(f)));
          }}
        />
        {previews.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {previews.map((src) => <img key={src} src={src} alt="" className="max-h-56 rounded-xl object-cover" />)}
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
