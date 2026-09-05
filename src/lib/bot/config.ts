/** Bot configuration read from the environment (see SPEC-TELEGRAM-BOT.md §8) and tunable constants. */

export type BotMode = "off" | "shadow" | "live";

function intEnv(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

function optString(name: string): string | null {
  const v = process.env[name]?.trim();
  return v ? v : null;
}

function parseMode(raw: string | undefined): BotMode {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "live" || v === "shadow" ? v : "off";
}

export const botConfig = () => ({
  token: process.env.TELEGRAM_BOT_TOKEN ?? "",
  groupChatId: optString("TELEGRAM_GROUP_CHAT_ID"),
  groupThreadId: optString("TELEGRAM_GROUP_THREAD_ID") ? intEnv("TELEGRAM_GROUP_THREAD_ID", 0) || null : null,
  proxyUrl: optString("TELEGRAM_PROXY_URL"),
  mode: parseMode(process.env.BOT_MODE),
  llm: {
    baseUrl: (process.env.LLM_BASE_URL ?? "").replace(/\/+$/, ""),
    apiKey: process.env.LLM_API_KEY ?? "",
    model: process.env.LLM_MODEL?.trim() || "gemini-3.8-flash-high",
  },
  digest: {
    weekday: intEnv("DIGEST_WEEKDAY", 0),
    hour: intEnv("DIGEST_HOUR", 20),
    llmComment: process.env.DIGEST_LLM_COMMENT === "1",
  },
  publicUrl: (process.env.PUBLIC_URL?.trim() || "https://tl-sport.ru").replace(/\/+$/, ""),
  timezone: "Europe/Moscow" as const,
});

export type BotConfig = ReturnType<typeof botConfig>;

/** Decision thresholds (spec §5.3). Tuned against the eval set. */
export const THRESHOLDS = { save: 0.75, ask: 0.45, bingoExplicit: 0.75, bingoOffer: 0.5 } as const;

export const LIMITS = {
  llmPerMinute: 20,
  llmInFlight: 3,
  llmTimeoutMs: 40_000,
  maxPhotos: 3,
  albumBufferMs: 3000,
  askExpiryHours: 24,
  announceMergeSeconds: 60,
  videoMaxBytes: 20 * 1024 * 1024,
} as const;
