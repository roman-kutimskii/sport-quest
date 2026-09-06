/**
 * Thin Telegram Bot API client on undici. Every call (including file downloads) goes through
 * TELEGRAM_PROXY_URL when set — Telegram is unreachable from the VPS directly (spec §3.1).
 */
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { z } from "zod";

// ---------- Types (the subset of Update we use) ----------

export type TgUser = { id: number; is_bot: boolean; first_name: string; last_name?: string; username?: string };
export type TgPhotoSize = { file_id: string; file_unique_id: string; width: number; height: number; file_size?: number };
export type TgMessage = {
  message_id: number;
  date: number;
  chat: { id: number; type: string; title?: string; is_forum?: boolean };
  from?: TgUser;
  message_thread_id?: number;
  text?: string;
  caption?: string;
  photo?: TgPhotoSize[];
  video?: { file_id: string; file_size?: number; mime_type?: string; thumbnail?: TgPhotoSize };
  document?: { file_id: string; file_size?: number; mime_type?: string; file_name?: string; thumbnail?: TgPhotoSize };
  media_group_id?: string;
  forward_origin?: unknown;
  forward_from?: unknown;
  forward_date?: number;
  reply_to_message?: TgMessage;
  entities?: TgEntity[];
  caption_entities?: TgEntity[];
};
/** `mention` = «@username» in the text; `text_mention` = a user without username, carried in `user`. Offsets are UTF-16 units. */
export type TgEntity = { type: string; offset: number; length: number; user?: TgUser };
export type TgCallbackQuery = { id: string; from: TgUser; message?: TgMessage; data?: string };
export type TgUpdate = { update_id: number; message?: TgMessage; edited_message?: TgMessage; callback_query?: TgCallbackQuery };

// ---------- Zod schemas (lenient: unknown keys pass through) ----------

const UserSchema = z
  .object({ id: z.number(), is_bot: z.boolean(), first_name: z.string(), last_name: z.string().optional(), username: z.string().optional() })
  .loose();

const PhotoSizeSchema = z
  .object({ file_id: z.string(), file_unique_id: z.string(), width: z.number(), height: z.number(), file_size: z.number().optional() })
  .loose();

const EntitySchema = z.object({ type: z.string(), offset: z.number(), length: z.number(), user: UserSchema.optional() }).loose();

const FileBaseSchema = { file_id: z.string(), file_size: z.number().optional(), mime_type: z.string().optional(), thumbnail: PhotoSizeSchema.optional() };

export const MessageSchema: z.ZodType<TgMessage> = z.lazy(() =>
  z
    .object({
      message_id: z.number(),
      date: z.number(),
      chat: z.object({ id: z.number(), type: z.string(), title: z.string().optional(), is_forum: z.boolean().optional() }).loose(),
      from: UserSchema.optional(),
      message_thread_id: z.number().optional(),
      text: z.string().optional(),
      caption: z.string().optional(),
      photo: z.array(PhotoSizeSchema).optional(),
      video: z.object(FileBaseSchema).loose().optional(),
      document: z.object({ ...FileBaseSchema, file_name: z.string().optional() }).loose().optional(),
      media_group_id: z.string().optional(),
      forward_origin: z.unknown().optional(),
      forward_from: z.unknown().optional(),
      forward_date: z.number().optional(),
      reply_to_message: MessageSchema.optional(),
      entities: z.array(EntitySchema).optional(),
      caption_entities: z.array(EntitySchema).optional(),
    })
    .loose(),
);

const CallbackQuerySchema = z
  .object({ id: z.string(), from: UserSchema, message: MessageSchema.optional(), data: z.string().optional() })
  .loose();

export const UpdateSchema: z.ZodType<TgUpdate> = z
  .object({
    update_id: z.number(),
    message: MessageSchema.optional(),
    edited_message: MessageSchema.optional(),
    callback_query: CallbackQuerySchema.optional(),
  })
  .loose();

export type InlineKeyboard = { inline_keyboard: { text: string; callback_data?: string; url?: string }[][] };

export type TgFile = { file_id: string; file_size?: number; file_path?: string };

// ---------- Errors ----------

export class TelegramApiError extends Error {
  code: number;
  description: string;
  retryAfter?: number;
  constructor(method: string, code: number, description: string, retryAfter?: number) {
    super(`Telegram ${method} failed: ${code} ${description}`);
    this.name = "TelegramApiError";
    this.code = code;
    this.description = description;
    this.retryAfter = retryAfter;
  }
}

type TgResponse<T> = { ok: true; result: T } | { ok: false; error_code: number; description: string; parameters?: { retry_after?: number } };

const DEFAULT_TIMEOUT_MS = 30_000;

// ---------- Client ----------

export class TelegramApi {
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly dispatcher?: ProxyAgent;

  constructor(opts: { token: string; proxyUrl?: string | null; fetchImpl?: typeof fetch }) {
    this.token = opts.token;
    this.dispatcher = opts.proxyUrl ? new ProxyAgent(opts.proxyUrl) : undefined;
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => undiciFetch(url as string, { ...(init as object), dispatcher: this.dispatcher }) as unknown as Promise<Response>);
  }

  private request(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    return this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  }

  async call<T>(method: string, params: Record<string, unknown> = {}, opts: { timeoutMs?: number } = {}): Promise<T> {
    const res = await this.request(
      `https://api.telegram.org/bot${this.token}/${method}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) },
      opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    let body: TgResponse<T>;
    try {
      body = (await res.json()) as TgResponse<T>;
    } catch {
      throw new TelegramApiError(method, res.status, `non-JSON response (HTTP ${res.status})`);
    }
    if (!body.ok) {
      throw new TelegramApiError(method, body.error_code ?? res.status, body.description ?? "unknown error", body.parameters?.retry_after);
    }
    return body.result;
  }

  /** Registers the «/» menu shown in chats (`/id` is deliberately left out: it is a setup command). */
  async setMyCommands(commands: { command: string; description: string }[], scope?: { type: string; chat_id?: string | number; user_id?: number }): Promise<void> {
    await this.call<boolean>("setMyCommands", { commands, ...(scope ? { scope } : {}) });
  }

  getMe(): Promise<TgUser> {
    return this.call<TgUser>("getMe");
  }

  /** Long-polls updates. Each update is validated; malformed ones are logged and skipped so the offset still advances past them. */
  async getUpdates(opts: { offset?: number; timeoutSec: number; allowedUpdates?: string[] }): Promise<TgUpdate[]> {
    const raw = await this.call<unknown[]>(
      "getUpdates",
      {
        offset: opts.offset,
        timeout: opts.timeoutSec,
        allowed_updates: opts.allowedUpdates ?? ["message", "callback_query"],
      },
      { timeoutMs: (opts.timeoutSec + 10) * 1000 },
    );
    const out: TgUpdate[] = [];
    for (const u of Array.isArray(raw) ? raw : []) {
      const parsed = UpdateSchema.safeParse(u);
      if (parsed.success) out.push(parsed.data);
      else {
        const id = (u as { update_id?: unknown })?.update_id;
        console.warn(`[tg] skipping malformed update ${String(id)}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
        if (typeof id === "number") out.push({ update_id: id });
      }
    }
    return out;
  }

  sendMessage(p: {
    chatId: string | number;
    text: string;
    threadId?: number | null;
    replyTo?: number | null;
    replyMarkup?: InlineKeyboard;
    parseMode?: "HTML";
    disablePreview?: boolean;
  }): Promise<TgMessage> {
    return this.call<TgMessage>("sendMessage", {
      chat_id: p.chatId,
      text: p.text,
      message_thread_id: p.threadId ?? undefined,
      reply_parameters: p.replyTo ? { message_id: p.replyTo, allow_sending_without_reply: true } : undefined,
      reply_markup: p.replyMarkup,
      parse_mode: p.parseMode,
      link_preview_options: p.disablePreview ? { is_disabled: true } : undefined,
    });
  }

  async editMessageText(p: { chatId: string | number; messageId: number; text: string; replyMarkup?: InlineKeyboard | null; parseMode?: "HTML" }): Promise<void> {
    await this.call("editMessageText", {
      chat_id: p.chatId,
      message_id: p.messageId,
      text: p.text,
      reply_markup: p.replyMarkup === null ? { inline_keyboard: [] } : p.replyMarkup,
      parse_mode: p.parseMode,
    });
  }

  async deleteMessage(chatId: string | number, messageId: number): Promise<void> {
    await this.call("deleteMessage", { chat_id: chatId, message_id: messageId });
  }

  async answerCallbackQuery(id: string, text?: string, showAlert?: boolean): Promise<void> {
    await this.call("answerCallbackQuery", { callback_query_id: id, text, show_alert: showAlert });
  }

  getFile(fileId: string): Promise<TgFile> {
    return this.call<TgFile>("getFile", { file_id: fileId });
  }

  /** Downloads a file previously resolved with getFile (goes through the proxy too). */
  async downloadFile(filePath: string): Promise<Buffer> {
    const res = await this.request(`https://api.telegram.org/file/bot${this.token}/${filePath}`, { method: "GET" }, 60_000);
    if (!res.ok) throw new TelegramApiError("downloadFile", res.status, `HTTP ${res.status} for ${filePath}`);
    return Buffer.from(await res.arrayBuffer());
  }
}

// ---------- Pure helpers ----------

export function isForwarded(m: TgMessage): boolean {
  return m.forward_origin != null || m.forward_from != null || m.forward_date != null;
}

/** Message text or media caption. */
export function messageText(m: TgMessage): string | null {
  const t = m.text ?? m.caption;
  return t && t.trim() ? t : null;
}

export function mediaKinds(m: TgMessage): ("photo" | "video" | "document")[] {
  const kinds: ("photo" | "video" | "document")[] = [];
  if (m.photo?.length) kinds.push("photo");
  if (m.video) kinds.push("video");
  if (m.document) kinds.push("document");
  return kinds;
}

/** "/top@botname 5" → { name: "top", args: "5" }; commands addressed to another bot → null. */
export function parseCommand(m: TgMessage, botUsername?: string): { name: string; args: string } | null {
  const text = m.text;
  if (!text) return null;
  const match = /^\/([a-zA-Z0-9_]+)(?:@([a-zA-Z0-9_]+))?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return null;
  const [, name, target, args] = match;
  if (target && botUsername && target.toLowerCase() !== botUsername.replace(/^@/, "").toLowerCase()) return null;
  return { name: name.toLowerCase(), args: (args ?? "").trim() };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
