import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { LlmError, OpenAiCompatLlm, RETRY_DELAYS_MS, isRetryableLlmError } from "./llm";

const completion = (content: string) => () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
const http = (status: number, headers?: Record<string, string>) => () => new Response("auth_unavailable", { status, headers });
const input = { system: "s", user: [{ type: "text" as const, text: "u" }] };

function client(responses: (() => Response)[]) {
  const fetchImpl = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra request");
    return next();
  });
  const sleeps: number[] = [];
  const llm = new OpenAiCompatLlm({
    baseUrl: "http://llm", apiKey: "k", model: "m",
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleepImpl: async (ms) => { sleeps.push(ms); },
    random: () => 0.5, // no jitter
  });
  return { llm, fetchImpl, sleeps };
}

describe("OpenAiCompatLlm retries", () => {
  it("redacts upstream bodies and transport causes from errors", async () => {
    const upstream = client([() => new Response("SECRET_API_KEY", { status: 401 })]);
    const upstreamError = await upstream.llm.complete(input).catch((e: unknown) => e);
    expect(String(upstreamError)).toContain("LLM HTTP 401");
    expect(String(upstreamError)).not.toContain("SECRET_API_KEY");
    const fail = () => { throw new Error("secret-url", { cause: { code: "ECONNREFUSED" } }); };
    const transport = client([fail, fail, fail]);
    const error = await transport.llm.complete(input).catch((e: unknown) => e);
    expect(String(error)).toContain("ECONNREFUSED");
    expect(String(error)).toContain("LLM_BASE_URL");
    expect(String(error)).not.toContain("secret-url");
  });
  it("rides out transient 503s with backoff", async () => {
    const { llm, fetchImpl, sleeps } = client([http(503), http(503), completion("{}")]);
    await expect(llm.complete(input)).resolves.toMatchObject({ text: "{}" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual(RETRY_DELAYS_MS);
  });

  it("gives up after 3 attempts and says so", async () => {
    const { llm, fetchImpl } = client([http(503), http(502), http(500)]);
    const err = await llm.complete(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).message).toMatch(/LLM HTTP 500.*after 3 attempts/);
    expect((err as LlmError).status).toBe(500);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("waits at least Retry-After on 429", async () => {
    const { llm, sleeps } = client([http(429, { "Retry-After": "90" }), completion("{}")]);
    await llm.complete(input);
    expect(sleeps).toEqual([90_000]);
  });

  it("retries a network timeout", async () => {
    const { llm, fetchImpl } = client([
      () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); },
      completion("{}"),
    ]);
    await expect(llm.complete(input)).resolves.toMatchObject({ text: "{}" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([400, 401, 403, 404, 422])("does not retry HTTP %i", async (status) => {
    const { llm, fetchImpl, sleeps } = client([http(status), completion("{}")]);
    await expect(llm.complete(input)).rejects.toMatchObject({ status });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it("does not retry an unusable 200 body", async () => {
    const nonJson = client([() => new Response("<html>", { status: 200 }), completion("{}")]);
    await expect(nonJson.llm.complete(input)).rejects.toThrow("non-JSON");
    expect(nonJson.fetchImpl).toHaveBeenCalledTimes(1);

    const empty = client([completion(""), completion("{}")]);
    await expect(empty.llm.complete(input)).rejects.toThrow("empty completion");
    expect(empty.fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("isRetryableLlmError", () => {
  it("splits transient from permanent failures", () => {
    expect(isRetryableLlmError(new LlmError("x", 503))).toBe(true);
    expect(isRetryableLlmError(new LlmError("x", 429))).toBe(true);
    expect(isRetryableLlmError(new LlmError("network"))).toBe(true);
    expect(isRetryableLlmError(new LlmError("x", 400))).toBe(false);
    expect(isRetryableLlmError(new LlmError("empty", 200))).toBe(false);
    expect(isRetryableLlmError(new Error("LLM output failed validation twice"))).toBe(false);
    expect(isRetryableLlmError(new z.ZodError([]))).toBe(false);
  });
});
