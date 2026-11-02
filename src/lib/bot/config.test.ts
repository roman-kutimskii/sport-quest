import { afterEach, describe, expect, it, vi } from "vitest";
import { botConfig } from "./config";

afterEach(() => vi.unstubAllEnvs());

describe("OpenAI configuration", () => {
  it("defaults to official OpenAI without reusing a private proxy key", () => {
    vi.stubEnv("LLM_BASE_URL", "");
    vi.stubEnv("LLM_MODEL", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("LLM_API_KEY", "private-proxy-key");
    vi.stubEnv("LLM_PROXY_URL", "");
    expect(botConfig().llm).toEqual({ baseUrl: "https://api.openai.com", model: "gpt-6.1-terra", apiKey: "", proxyUrl: null });
  });

  it("reads the official API key and normalizes explicit configuration", () => {
    vi.stubEnv("LLM_BASE_URL", " https://api.openai.com/ ");
    vi.stubEnv("LLM_MODEL", " gpt-6.1-terra ");
    vi.stubEnv("OPENAI_API_KEY", " official-test-key ");
    vi.stubEnv("LLM_PROXY_URL", " http://xray:18080 ");
    expect(botConfig().llm).toEqual({ baseUrl: "https://api.openai.com", model: "gpt-6.1-terra", apiKey: "official-test-key", proxyUrl: "http://xray:18080" });
  });
});
