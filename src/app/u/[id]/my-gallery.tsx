import Link from "next/link";
import { Thumb } from "@/components/proof";
import { toggleGalleryProof } from "@/app/log/actions";
import { formatRuDate, toDateStr } from "@/lib/scoring/dates";

type Report = { id: string; date: Date; status: string; proofUrls: string[]; galleryUrls: string[] };

/** Owner-only: every photo from their reports as a tile; click a tile to show it in / hide it from the gallery. */
export function MyGallery({ reports }: { reports: Report[] }) {
  // A photo attached to several reports of one submission (activity + bingo) is listed once.
  const seen = new Set<string>();
  const items = reports
    .filter((r) => r.status !== "REJECTED")
    .flatMap((r) => r.proofUrls.map((url) => ({ url, reportId: r.id, date: toDateStr(r.date), shared: r.galleryUrls.includes(url) })))
    .filter((it) => !seen.has(it.url) && seen.add(it.url));
  const shared = items.filter((i) => i.shared).length;

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold">🍁 Моя галерея <span className="text-fgm">({shared} из {items.length})</span></h2>
        <Link href="/gallery" className="text-xs text-fgm hover:underline">Общая галерея →</Link>
      </div>
      <p className="mt-1 text-xs text-fgm">Сюда попадают все фото из твоих отчётов, но в общей галерее их не видно, пока ты их не выберешь. Нажми на фото, чтобы показать или скрыть его.</p>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-fgm">Пока нет фото — прикрепляй их к отчётам.</p>
      ) : (
        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {items.map((it) => (
            <form key={it.url} action={toggleGalleryProof} className="min-w-0">
              <input type="hidden" name="id" value={it.reportId} />
              <input type="hidden" name="url" value={it.url} />
              <button
                type="submit"
                aria-pressed={it.shared}
                title={it.shared ? "Убрать из галереи" : "Показать в галерее"}
                className={`relative block w-full rounded-xl border-2 p-1 text-left transition ${it.shared ? "border-accent bg-accent-soft" : "border-transparent opacity-60 hover:opacity-100"}`}
              >
                <Thumb url={it.url} className="aspect-square w-full" />
                <span className={`absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-sm shadow ${it.shared ? "bg-accent text-white" : "bg-elev text-fgm"}`} aria-hidden>
                  {it.shared ? "✓" : "＋"}
                </span>
                <div className="mt-1 truncate text-center text-[10px] text-fgm">{formatRuDate(it.date)}</div>
              </button>
            </form>
          ))}
        </div>
      )}
    </section>
  );
}
