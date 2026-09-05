import { messageLink } from "@/lib/bot/undo";
import { undoTelegramLink } from "../actions";
import { STATUS, describeExtraction, fmt, mediaIcons, type FeedRow } from "./data";

export function LinkRow({ l }: { l: FeedRow }) {
  const st = STATUS[l.status] ?? { label: l.status, cls: "bg-muted" };
  const url = messageLink(l.chatId, l.messageId, l.threadId);
  const who = l.user ? `${l.user.avatarEmoji} ${l.user.name}` : (l.fromName ?? l.fromUserId);
  const lowConfidence = l.confidence != null && l.confidence < 0.7;
  return (
    <li className="grid gap-1 px-5 py-3 sm:grid-cols-[7rem_1fr_auto] sm:items-start sm:gap-3">
      <div className="text-xs text-fgm">{fmt(l.messageDate)}</div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{who}</span>
          {!l.user && <span className="chip bg-warn-soft text-fg">без аккаунта</span>}
          <span className={`chip ${st.cls}`}>{st.label}</span>
          {lowConfidence && <span className="text-xs text-danger">{Math.round(l.confidence! * 100)}%</span>}
          {l.albumMedia.length > 0 && (
            <span className="text-xs text-fgm">{l.albumMedia.length > 1 ? `${mediaIcons([l.albumMedia[0]])}×${l.albumMedia.length}` : mediaIcons(l.albumMedia)}</span>
          )}
        </div>
        {l.text && <details className="text-fgm"><summary className="cursor-pointer truncate">{l.text}</summary><p className="whitespace-pre-wrap pt-1 text-xs">{l.text}</p></details>}
        {l.extraction != null && <div className="text-xs">{describeExtraction(l.extraction)}</div>}
        {l.error && <div className="text-xs text-danger">{l.error}</div>}
      </div>
      <div className="flex items-center gap-2">
        {url && <a href={url} target="_blank" rel="noreferrer" className="btn-ghost !px-2 !py-1 text-xs">открыть</a>}
        {l.reports.length > 0 && (
          <form action={undoTelegramLink}>
            <input type="hidden" name="id" value={l.id} />
            <button className="btn-danger !px-2 !py-1 text-xs">удалить отчёты ({l.reports.length})</button>
          </form>
        )}
      </div>
    </li>
  );
}
