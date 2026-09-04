import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getActiveQuest, getGallery } from "@/lib/quest";
import { formatRuDate } from "@/lib/scoring/dates";
import { Proof } from "@/components/proof";

export const dynamic = "force-dynamic";

export default async function GalleryPage() {
  const [, quest] = await Promise.all([requireUser(), getActiveQuest()]);
  const groups = await getGallery(quest);
  const total = groups.reduce((s, g) => s + g.items.length, 0);

  return (
    <div className="space-y-6">
      <header className="text-center">
        <div className="text-5xl">🍁</div>
        <h1 className="mt-3 text-2xl font-bold sm:text-3xl">Галерея осени</h1>
        <p className="mt-2 text-fgm">{total} фото и видео из засчитанных отчётов.</p>
        {quest.votingOpen && (
          <Link href="/vote" className="btn-primary mt-4">📸 Выбрать Амбассадора Осени</Link>
        )}
      </header>

      {groups.length === 0 && (
        <div className="card p-8 text-center text-fgm">Пока пусто. Отметь свои лучшие фото «в галерею» в профиле или поставь галочку при отправке отчёта.</div>
      )}

      {groups.map((g) => (
        <section key={g.user.id} className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <Link href={`/u/${g.user.id}`} className="font-bold hover:underline">{g.user.avatarEmoji} {g.user.name}</Link>
            <span className="text-xs text-fgm">{g.items.length}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 p-4 sm:grid-cols-4 md:grid-cols-6">
            {g.items.map((it) => (
              <figure key={it.url} className="min-w-0">
                <Proof url={it.url} className="aspect-square w-full" />
                <figcaption className="mt-1 truncate text-center text-xs text-fgm">{formatRuDate(it.date)}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
