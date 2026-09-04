import { Proof } from "@/components/proof";
import { toggleGalleryProof } from "@/app/log/actions";

/** Owner's view of a report's proofs: each one can be shown in or hidden from the gallery. */
export function GalleryProofs({ reportId, urls, galleryUrls }: { reportId: string; urls: string[]; galleryUrls: string[] }) {
  return (
    <div className="flex flex-wrap gap-3">
      {urls.map((url) => {
        const shared = galleryUrls.includes(url);
        return (
          <div key={url} className="flex flex-col items-start gap-1">
            <Proof url={url} className="max-h-40" />
            <form action={toggleGalleryProof}>
              <input type="hidden" name="id" value={reportId} />
              <input type="hidden" name="url" value={url} />
              <button className={`chip ${shared ? "bg-ok-soft text-ok" : "bg-muted text-fgm hover:text-fg"}`} title={shared ? "Убрать из галереи" : "Показать в галерее"}>
                {shared ? "🍁 в галерее" : "＋ в галерею"}
              </button>
            </form>
          </div>
        );
      })}
    </div>
  );
}
