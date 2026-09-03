import type { ScoreBreakdown } from "@/lib/scoring";
import { addDays } from "@/lib/scoring/dates";

const MONTHS_NOM = ["январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"];

/** Sep–Nov calendar heatmap built from dayMap. */
export function QuestCalendar({ start, end, today, dayMap }: { start: string; end: string; today: string; dayMap: ScoreBreakdown["dayMap"] }) {
  const months: { label: string; cells: (string | null)[] }[] = [];
  let cursor = start.slice(0, 7);
  const endMonth = end.slice(0, 7);
  while (cursor <= endMonth) {
    const [y, m] = cursor.split("-").map(Number);
    const first = `${cursor}-01`;
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const firstDow = (new Date(first + "T00:00:00Z").getUTCDay() + 6) % 7; // Monday = 0
    const cells: (string | null)[] = Array(firstDow).fill(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(`${cursor}-${String(d).padStart(2, "0")}`);
    months.push({ label: MONTHS_NOM[m - 1], cells });
    cursor = addDays(first, daysInMonth).slice(0, 7);
  }
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {months.map((mo) => (
        <div key={mo.label}>
          <div className="mb-2 text-sm font-semibold capitalize">{mo.label}</div>
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-fgm">
            {["пн", "вт", "ср", "чт", "пт", "сб", "вс"].map((d) => <div key={d}>{d}</div>)}
            {mo.cells.map((d, i) => {
              if (!d) return <div key={i} />;
              const inRange = d >= start && d <= end;
              const cell = dayMap[d];
              const future = d > today;
              const cls = !inRange ? "opacity-20 bg-muted"
                : future ? "bg-muted/60 border border-dashed border-line"
                : cell?.active ? (cell.awards.length ? "bg-accent-strong text-white" : "bg-accent text-white")
                : cell?.pending ? "bg-warn-soft"
                : "bg-muted";
              const title = [d, cell?.active ? "активный день" : cell?.pending ? "на проверке" : "", cell?.bingoKey ? `бинго: ${cell.bingoKey}` : "", ...(cell?.awards ?? []).map((a) => `бонус ${a}`), cell?.steps ? `${cell.steps} шагов` : ""].filter(Boolean).join(" · ");
              return (
                <div key={d} title={title} className={`relative flex aspect-square items-center justify-center rounded-md text-[11px] font-medium ${cls} ${d === today ? "ring-2 ring-accent ring-offset-1 ring-offset-bg" : ""}`}>
                  {Number(d.slice(-2))}
                  {cell?.bingoKey && <span className="absolute -right-0.5 -top-0.5 text-[9px]">🎯</span>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
