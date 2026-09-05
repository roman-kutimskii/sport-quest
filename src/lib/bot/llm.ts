/**
 * LLM access behind one small interface (spec §3.4): OpenAI-compatible chat completions via
 * CLIProxyAPI today; switching to another transport is a one-file change.
 */

export type LlmPart = { type: "text"; text: string } | { type: "image"; mime: string; data: Buffer };

export interface LlmClient {
  complete(input: { system: string; user: LlmPart[]; json?: boolean }): Promise<{ text: string; raw?: unknown }>;
}

export class LlmError extends Error {
  status?: number;
  constructor(message: string, status?: number, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LlmError";
    this.status = status;
  }
}

const RETRY_DELAYS_MS = [1000, 3000];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type ChatCompletion = { choices?: { message?: { content?: string | { type: string; text?: string }[] } }[] };

export class OpenAiCompatLlm implements LlmClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(opts: { baseUrl: string; apiKey: string; model: string; timeoutMs?: number; fetchImpl?: typeof fetch; sleepImpl?: (ms: number) => Promise<void> }) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.timeoutMs = opts.timeoutMs ?? 40_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleepImpl = opts.sleepImpl ?? sleep;
  }

  async complete(input: { system: string; user: LlmPart[]; json?: boolean }): Promise<{ text: string; raw?: unknown }> {
    const body = {
      model: this.model,
      temperature: 0,
      messages: [
        { role: "system", content: input.system },
        {
          role: "user",
          content: input.user.map((p) =>
            p.type === "text"
              ? { type: "text", text: p.text }
              : { type: "image_url", image_url: { url: `data:${p.mime};base64,${p.data.toString("base64")}` } },
          ),
        },
      ],
      ...(input.json ? { response_format: { type: "json_object" } } : {}),
    };

    let lastError: LlmError | undefined;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      if (attempt > 0) await this.sleepImpl(RETRY_DELAYS_MS[attempt - 1]);
      try {
        return await this.once(body);
      } catch (e) {
        const err = e instanceof LlmError ? e : new LlmError(`LLM request failed: ${String(e)}`, undefined, { cause: e });
        const retryable = err.status === undefined || err.status === 429 || err.status >= 500;
        if (!retryable) throw err;
        lastError = err;
      }
    }
    throw lastError ?? new LlmError("LLM request failed");
  }

  private async once(body: unknown): Promise<{ text: string; raw: unknown }> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new LlmError(`LLM network error: ${e instanceof Error ? e.message : String(e)}`, undefined, { cause: e });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new LlmError(`LLM HTTP ${res.status}: ${text.slice(0, 300)}`, res.status);
    }
    let raw: ChatCompletion;
    try {
      raw = (await res.json()) as ChatCompletion;
    } catch (e) {
      throw new LlmError("LLM returned non-JSON body", 200, { cause: e });
    }
    const content = raw.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => c.text ?? "").join("") : "";
    if (!text) throw new LlmError("LLM returned an empty completion", 200);
    return { text, raw };
  }
}

/** Sliding-window rate limiter: at most `perMinute` acquisitions in any 60 s window; `acquire()` waits otherwise. */
export class RateLimiter {
  private readonly stamps: number[] = [];
  private readonly windowMs = 60_000;

  constructor(private readonly perMinute: number, private readonly now: () => number = Date.now, private readonly sleepImpl: (ms: number) => Promise<void> = sleep) {}

  async acquire(): Promise<void> {
    for (;;) {
      const t = this.now();
      while (this.stamps.length && this.stamps[0] <= t - this.windowMs) this.stamps.shift();
      if (this.stamps.length < this.perMinute) {
        this.stamps.push(t);
        return;
      }
      await this.sleepImpl(Math.max(1, this.stamps[0] + this.windowMs - t));
    }
  }
}
