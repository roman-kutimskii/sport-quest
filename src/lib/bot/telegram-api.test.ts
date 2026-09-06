import { describe, expect, it } from "vitest";
import { TelegramApi, TelegramApiError, UpdateSchema, escapeHtml, isForwarded, mediaKinds, messageText, parseCommand, type TgMessage } from "./telegram-api";

const GROUP = { id: -1001234567890, title: "Осенний квест", type: "supergroup", is_forum: true };
const USER = { id: 111, is_bot: false, first_name: "Маша", last_name: "Иванова", username: "masha", language_code: "ru" };
const photo = [
  { file_id: "s", file_unique_id: "us", file_size: 1500, width: 90, height: 120 },
  { file_id: "m", file_unique_id: "um", file_size: 20000, width: 320, height: 427 },
  { file_id: "x", file_unique_id: "ux", file_size: 90000, width: 800, height: 1067 },
  { file_id: "y", file_unique_id: "uy", file_size: 150000, width: 1280, height: 1707 },
];

const fixtures = {
  text: { update_id: 1, message: { message_id: 10, from: USER, chat: GROUP, date: 1757000000, message_thread_id: 5, text: "пробежала 5 км" } },
  photo: { update_id: 2, message: { message_id: 11, from: USER, chat: GROUP, date: 1757000100, photo, caption: "зал" } },
  album1: { update_id: 3, message: { message_id: 12, from: USER, chat: GROUP, date: 1757000200, media_group_id: "13000000123", photo, caption: "прогулка" } },
  album2: { update_id: 4, message: { message_id: 13, from: USER, chat: GROUP, date: 1757000200, media_group_id: "13000000123", photo } },
  video: { update_id: 5, message: { message_id: 14, from: USER, chat: GROUP, date: 1757000300, video: { file_id: "v", file_unique_id: "uv", width: 1080, height: 1920, duration: 42, mime_type: "video/mp4", file_size: 25 * 1024 * 1024, thumbnail: photo[1] } } },
  forwarded: { update_id: 6, message: { message_id: 15, from: USER, chat: GROUP, date: 1757000400, forward_origin: { type: "user", sender_user: { id: 222, is_bot: false, first_name: "Петя" }, date: 1756000000 }, forward_date: 1756000000, text: "10 км!" } },
  callback: { update_id: 7, callback_query: { id: "4382bfdwdsb323b2d9", from: USER, chat_instance: "-1", message: { message_id: 16, from: { id: 999, is_bot: true, first_name: "Bot" }, chat: GROUP, date: 1757000500, text: "Записал" }, data: "b:abc" } },
  edited: { update_id: 8, edited_message: { message_id: 10, from: USER, chat: GROUP, date: 1757000000, edit_date: 1757000600, text: "пробежала 6 км" } },
  mentions: { update_id: 10, message: { message_id: 11, from: USER, chat: GROUP, date: 1757000800, caption: "Пробежали с @masha и Петей", caption_entities: [{ type: "mention", offset: 12, length: 6 }, { type: "text_mention", offset: 21, length: 5, user: { id: 42, is_bot: false, first_name: "Петя" } }], photo: [{ file_id: "p", file_unique_id: "u", width: 1, height: 1 }] } },
  otherChat: { update_id: 9, message: { message_id: 1, from: USER, chat: { id: 111, type: "private", first_name: "Маша" }, date: 1757000700, text: "/me" } },
};

describe("UpdateSchema", () => {
  it("parses every fixture and keeps unknown keys", () => {
    for (const f of Object.values(fixtures)) expect(UpdateSchema.safeParse(f).success, JSON.stringify(f).slice(0, 60)).toBe(true);
    const u = UpdateSchema.parse(fixtures.edited);
    expect((u.edited_message as unknown as { edit_date: number }).edit_date).toBe(1757000600);
    const m = UpdateSchema.parse(fixtures.mentions).message!;
    expect(m.caption_entities?.[1].user?.id).toBe(42);
  });

  it("exposes the fields the bot needs", () => {
    const a1 = UpdateSchema.parse(fixtures.album1).message!;
    const a2 = UpdateSchema.parse(fixtures.album2).message!;
    expect(a1.media_group_id).toBe(a2.media_group_id);
    expect(messageText(a1)).toBe("прогулка");
    expect(messageText(a2)).toBeNull();
    expect(mediaKinds(a1)).toEqual(["photo"]);

    const v = UpdateSchema.parse(fixtures.video).message!;
    expect(mediaKinds(v)).toEqual(["video"]);
    expect(v.video!.file_size).toBeGreaterThan(20 * 1024 * 1024);
    expect(v.video!.thumbnail?.file_id).toBe("m");

    expect(isForwarded(UpdateSchema.parse(fixtures.forwarded).message!)).toBe(true);
    expect(isForwarded(UpdateSchema.parse(fixtures.text).message!)).toBe(false);

    const cb = UpdateSchema.parse(fixtures.callback).callback_query!;
    expect(cb.data).toBe("b:abc");
    expect(cb.message?.message_id).toBe(16);

    expect(UpdateSchema.parse(fixtures.otherChat).message!.chat.id).not.toBe(GROUP.id);
    expect(UpdateSchema.parse(fixtures.text).message!.message_thread_id).toBe(5);
  });

  it("rejects structurally broken updates", () => {
    expect(UpdateSchema.safeParse({ update_id: "x" }).success).toBe(false);
    expect(UpdateSchema.safeParse({ update_id: 1, message: { message_id: 1 } }).success).toBe(false);
  });
});

describe("parseCommand", () => {
  const msg = (text: string): TgMessage => ({ message_id: 1, date: 0, chat: GROUP, text });
  it("handles @botname and args", () => {
    expect(parseCommand(msg("/me"))).toEqual({ name: "me", args: "" });
    expect(parseCommand(msg("/top@SportQuestBot"), "SportQuestBot")).toEqual({ name: "top", args: "" });
    expect(parseCommand(msg("/top@sportquestbot 5"), "@SportQuestBot")).toEqual({ name: "top", args: "5" });
    expect(parseCommand(msg("/top@OtherBot"), "SportQuestBot")).toBeNull();
    expect(parseCommand(msg("пробежал /me"))).toBeNull();
    expect(parseCommand({ message_id: 1, date: 0, chat: GROUP, caption: "/me" })).toBeNull();
  });
});

describe("escapeHtml", () => {
  it("escapes the four characters", () => expect(escapeHtml('<a href="x">&</a>')).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;"));
});

type Call = { url: string; body: Record<string, unknown> };
function stubFetch(responder: (call: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), body: init?.body ? JSON.parse(String(init.body)) : {} };
    calls.push(call);
    const r = responder(call);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("TelegramApi", () => {
  it("getUpdates posts offset/timeout and skips malformed updates without throwing", async () => {
    const { calls, fetchImpl } = stubFetch(() => ({ body: { ok: true, result: [fixtures.text, { update_id: 99, message: { broken: true } }, fixtures.callback] } }));
    const api = new TelegramApi({ token: "T", fetchImpl });
    const updates = await api.getUpdates({ offset: 42, timeoutSec: 30 });
    expect(calls[0].url).toBe("https://api.telegram.org/botT/getUpdates");
    expect(calls[0].body).toMatchObject({ offset: 42, timeout: 30, allowed_updates: ["message", "callback_query"] });
    expect(updates.map((u) => u.update_id)).toEqual([1, 99, 7]);
    expect(updates[1]).toEqual({ update_id: 99 });
    expect(updates[0].message?.text).toBe("пробежала 5 км");
  });

  it("sendMessage maps params and returns the message", async () => {
    const { calls, fetchImpl } = stubFetch(() => ({ body: { ok: true, result: { message_id: 77, date: 1, chat: GROUP, text: "hi" } } }));
    const api = new TelegramApi({ token: "T", fetchImpl });
    const m = await api.sendMessage({ chatId: GROUP.id, text: "hi", threadId: 5, replyTo: 10, replyMarkup: { inline_keyboard: [[{ text: "Да", callback_data: "y:1" }]] } });
    expect(m.message_id).toBe(77);
    expect(calls[0].url).toBe("https://api.telegram.org/botT/sendMessage");
    expect(calls[0].body).toEqual({
      chat_id: GROUP.id, text: "hi", message_thread_id: 5,
      reply_parameters: { message_id: 10, allow_sending_without_reply: true },
      reply_markup: { inline_keyboard: [[{ text: "Да", callback_data: "y:1" }]] },
    });
  });

  it("429 → TelegramApiError with retryAfter", async () => {
    const { fetchImpl } = stubFetch(() => ({ status: 429, body: { ok: false, error_code: 429, description: "Too Many Requests: retry after 7", parameters: { retry_after: 7 } } }));
    const api = new TelegramApi({ token: "T", fetchImpl });
    const err = await api.sendMessage({ chatId: 1, text: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(TelegramApiError);
    expect(err.code).toBe(429);
    expect(err.retryAfter).toBe(7);
    expect(err.description).toMatch(/retry after/);
  });

  it("409 propagates code", async () => {
    const { fetchImpl } = stubFetch(() => ({ status: 409, body: { ok: false, error_code: 409, description: "Conflict: terminated by other getUpdates request" } }));
    await expect(new TelegramApi({ token: "T", fetchImpl }).getUpdates({ timeoutSec: 1 })).rejects.toMatchObject({ code: 409 });
  });

  it("downloadFile hits the file endpoint", async () => {
    const fetchImpl = (async (url: string | URL | Request) => new Response(Buffer.from(`bytes:${String(url)}`))) as typeof fetch;
    const api = new TelegramApi({ token: "T", fetchImpl });
    const buf = await api.downloadFile("photos/file_1.jpg");
    expect(buf.toString()).toBe("bytes:https://api.telegram.org/file/botT/photos/file_1.jpg");
  });
});
