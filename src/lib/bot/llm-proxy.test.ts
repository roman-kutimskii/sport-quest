import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), proxy: vi.fn() }));
vi.mock("undici", () => ({
  fetch: mocks.fetch,
  ProxyAgent: class {
    constructor(url: string) { mocks.proxy(url); }
  },
}));

import { OpenAiCompatLlm } from "./llm";

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("LLM outbound proxy", () => {
  it("keeps OpenAI as the HTTPS destination and sends requests through the configured dispatcher", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] })));
    const llm = new OpenAiCompatLlm({ baseUrl: "https://api.openai.com", apiKey: "test-key", model: "gpt-6.1-terra", proxyUrl: "http://xray:18080" });
    await expect(llm.complete({ system: "s", user: [{ type: "text", text: "u" }] })).resolves.toMatchObject({ text: "ok" });
    expect(mocks.proxy).toHaveBeenCalledWith("http://xray:18080");
    expect(mocks.fetch).toHaveBeenCalledWith("https://api.openai.com/v1/chat/completions", expect.objectContaining({
      dispatcher: expect.any(Object), headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
    }));
  });

  it("does not fall back to a direct request when the proxy fails or expose proxy credentials", async () => {
    const directFetch = vi.fn();
    vi.stubGlobal("fetch", directFetch);
    mocks.fetch.mockRejectedValue(new Error("http://user:SECRET@proxy", { cause: { code: "ECONNREFUSED" } }));
    const llm = new OpenAiCompatLlm({
      baseUrl: "https://api.openai.com", apiKey: "test-key", model: "gpt-6.1-terra",
      proxyUrl: "http://user:SECRET@proxy", sleepImpl: async () => {},
    });
    const error = await llm.complete({ system: "s", user: [] }).catch((e: unknown) => e);
    expect(String(error)).toContain("ECONNREFUSED");
    expect(String(error)).not.toContain("SECRET");
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(directFetch).not.toHaveBeenCalled();
  });
});
