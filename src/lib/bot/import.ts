/**
 * Pure helpers for importing a Telegram Desktop chat export (Export chat history → JSON) into the
 * bot pipeline. See scripts/bot-import.ts for the runner.
 */
import type { User } from "@/lib/db";

/** Subset of a message in `result.json`. `text` is a string or an array of strings / entity objects. */
export type ExportMessage = {
  id: number;
  type: string;
  date: string;
  date_unixtime?: string;
  from?: string;
  from_id?: string;
  text?: string | (string | { type: string; text: string })[];
  text_entities?: { type: string; text: string }[];
  photo?: string;
  file?: string;
  mime_type?: string;
  media_type?: string;
  thumbnail?: string;
  forwarded_from?: string;
  reply_to_message_id?: number;
};

export type ExportFile = { name?: string; type?: string; id: number; messages: ExportMessage[] };

/** "user626805724" → "626805724"; channels/anonymous admins → null. */
export function senderId(m: ExportMessage): string | null {
  const match = /^user(\d+)$/.exec(m.from_id ?? "");
  return match ? match[1] : null;
}

export function exportText(m: ExportMessage): string | null {
  let t: string;
  if (m.text_entities?.length) t = m.text_entities.map((e) => e.text).join("");
  else if (typeof m.text === "string") t = m.text;
  else if (Array.isArray(m.text)) t = m.text.map((p) => (typeof p === "string" ? p : p.text)).join("");
  else t = "";
  t = t.trim();
  return t || null;
}

/** Unix seconds of the message. `date` in exports has no zone: treated as `fallbackTz` when `date_unixtime` is absent. */
export function exportUnixTime(m: ExportMessage, fallbackTz = "Europe/Moscow"): number {
  if (m.date_unixtime && /^\d+$/.test(m.date_unixtime)) return Number(m.date_unixtime);
  return localToUnix(m.date, fallbackTz);
}

/** Interprets a zone-less "YYYY-MM-DDTHH:MM:SS" as wall time in `tz`. */
export function localToUnix(local: string, tz: string): number {
  const [d, t = "00:00:00"] = local.split("T");
  const [y, mo, da] = d.split("-").map(Number);
  const [h, mi, s] = t.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, da, h, mi, s);
  const offset = tzOffsetMs(new Date(guess), tz);
  return Math.round((guess - offset) / 1000);
}

function tzOffsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const get = (k: string) => Number(parts.find((p) => p.type === k)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - at.getTime();
}

export function exportMediaKind(m: ExportMessage): "photo" | "video" | "document" | null {
  if (m.photo) return "photo";
  if (m.media_type === "video_file" || m.media_type === "video_message" || (m.mime_type ?? "").startsWith("video/")) return "video";
  if (m.file) return "document";
  return null;
}

/** Chat export id (positive) → Bot API chat id of a supergroup. */
export function exportChatId(exportId: number): string {
  return `-100${exportId}`;
}

/**
 * Regular user messages in [sinceUnix, untilUnix), grouped into albums: consecutive messages from
 * the same sender within `albumWindowSec` that all carry media and have at most one caption.
 */
export function groupExportMessages(messages: ExportMessage[], opts: { sinceUnix: number; untilUnix: number; albumWindowSec?: number }): ExportMessage[][] {
  const window = opts.albumWindowSec ?? 2;
  const eligible = messages
    .filter((m) => m.type === "message" && senderId(m) !== null)
    .map((m) => ({ m, t: exportUnixTime(m) }))
    .filter(({ t }) => t >= opts.sinceUnix && t < opts.untilUnix)
    .sort((a, b) => a.t - b.t || a.m.id - b.m.id);

  const groups: ExportMessage[][] = [];
  let current: { m: ExportMessage; t: number }[] = [];
  const flush = () => { if (current.length) groups.push(current.map((x) => x.m)); current = []; };
  for (const item of eligible) {
    const last = current[current.length - 1];
    const joinable =
      last !== undefined &&
      senderId(last.m) === senderId(item.m) &&
      exportMediaKind(last.m) !== null &&
      exportMediaKind(item.m) !== null &&
      item.t - last.t <= window &&
      !(exportText(item.m) && current.some((x) => exportText(x.m)));
    if (!joinable) flush();
    current.push(item);
  }
  flush();
  return groups;
}

export type SenderMatch = { user: User; how: "id" | "map" | "name" } | null;

/**
 * Exports carry the sender's display name but no @username, so matching falls back to an exact
 * (case-insensitive) name match after the numeric id and an explicit map. Never creates accounts.
 */
export function matchSender(m: ExportMessage, users: User[], map: Record<string, string>): SenderMatch {
  const id = senderId(m);
  if (!id) return null;
  const byId = users.find((u) => u.telegramUserId === id);
  if (byId) return { user: byId, how: "id" };
  const mapped = map[id] ? users.find((u) => u.id === map[id]) : undefined;
  if (mapped) return { user: mapped, how: "map" };
  const name = (m.from ?? "").trim().toLowerCase();
  if (!name) return null;
  const byName = users.filter((u) => u.name.trim().toLowerCase() === name);
  return byName.length === 1 ? { user: byName[0], how: "name" } : null;
}
