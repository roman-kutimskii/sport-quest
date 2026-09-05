import { describe, expect, it } from "vitest";
import type { User } from "@/lib/db";
import { exportChatId, exportMediaKind, exportText, exportUnixTime, groupExportMessages, localToUnix, matchSender, senderId, type ExportMessage } from "./import";

const msg = (id: number, over: Partial<ExportMessage> = {}): ExportMessage => ({
  id, type: "message", date: "2026-09-04T19:00:00", date_unixtime: String(1788548400 + id), from: "Аня", from_id: "user111", text: "", ...over,
});

describe("telegram export helpers", () => {
  it("extracts sender id and text", () => {
    expect(senderId(msg(1))).toBe("111");
    expect(senderId(msg(1, { from_id: "channel5" }))).toBeNull();
    expect(exportText(msg(1, { text: "  привет " }))).toBe("привет");
    expect(exportText(msg(1, { text: ["бег ", { type: "bold", text: "5 км" }] }))).toBe("бег 5 км");
    expect(exportText(msg(1, { text_entities: [{ type: "plain", text: "зал" }, { type: "hashtag", text: "#спорт" }] }))).toBe("зал#спорт");
    expect(exportText(msg(1, { text: "" }))).toBeNull();
  });

  it("resolves times: unixtime wins, zone-less date is Moscow", () => {
    expect(exportUnixTime(msg(1, { date_unixtime: "1700000000" }))).toBe(1700000000);
    expect(localToUnix("2026-09-04T19:00:00", "Europe/Moscow")).toBe(Date.UTC(2026, 8, 4, 16, 0, 0) / 1000);
    expect(exportUnixTime({ id: 1, type: "message", date: "2026-09-04T00:30:00" })).toBe(Date.UTC(2026, 8, 3, 21, 30, 0) / 1000);
  });

  it("classifies media and chat ids", () => {
    expect(exportMediaKind(msg(1, { photo: "photos/a.jpg" }))).toBe("photo");
    expect(exportMediaKind(msg(1, { file: "video_files/a.mp4", media_type: "video_file", mime_type: "video/mp4" }))).toBe("video");
    expect(exportMediaKind(msg(1, { file: "files/a.pdf", mime_type: "application/pdf" }))).toBe("document");
    expect(exportMediaKind(msg(1))).toBeNull();
    expect(exportChatId(2365064378)).toBe("-1002365064378");
  });

  it("groups albums and respects the time range", () => {
    const list = [
      msg(1, { text: "зал" }),
      msg(2, { photo: "p2.jpg", text: "бег 5 км" }),
      msg(3, { photo: "p3.jpg" }),                     // album with 2
      msg(4, { photo: "p4.jpg", text: "ещё" }),        // has its own caption → separate
      msg(10, { photo: "p10.jpg", from_id: "user222", from: "Боря" }),
      msg(11, { photo: "p11.jpg", from_id: "user222", from: "Боря", date_unixtime: String(1788548400 + 10 + 30) }), // 30 s later → separate
      msg(20, { type: "service" }),
      msg(21, { from_id: "channel9" }),
    ];
    const groups = groupExportMessages(list, { sinceUnix: 0, untilUnix: 1788548400 + 100 });
    expect(groups.map((g) => g.map((m) => m.id))).toEqual([[1], [2, 3], [4], [10], [11]]);
    expect(groupExportMessages(list, { sinceUnix: 1788548400 + 4, untilUnix: 1788548400 + 11 }).map((g) => g[0].id)).toEqual([4, 10]);
  });

  it("matches senders by id, map, then unique name; never by ambiguous name", () => {
    const u = (id: string, name: string, tg: string | null): User => ({ id, name, telegramUserId: tg } as unknown as User);
    const users = [u("a", "Аня", "111"), u("b", "Боря", null), u("c", "Вася", null), u("d", "Вася", null)];
    expect(matchSender(msg(1), users, {})?.how).toBe("id");
    expect(matchSender(msg(1, { from_id: "user222", from: "боря " }), users, {})).toMatchObject({ how: "name", user: { id: "b" } });
    expect(matchSender(msg(1, { from_id: "user333", from: "Вася" }), users, {})).toBeNull();
    expect(matchSender(msg(1, { from_id: "user333", from: "Вася" }), users, { "333": "c" })?.how).toBe("map");
    expect(matchSender(msg(1, { from_id: "user444", from: "Кто-то" }), users, {})).toBeNull();
  });
});
