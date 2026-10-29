import { describe, expect, it } from "vitest";
import { inspect } from "node:util";
import { networkErrorCode, telegramNetworkError } from "./network-error";

describe("safe network diagnostics", () => {
  it("reports the nested transport code without leaking credentials from causes", () => {
    const original = new Error("https://api.telegram.org/botSECRET/getMe", {
      cause: Object.assign(new Error("http://user:PASSWORD@proxy"), { code: "ECONNREFUSED" }),
    });
    const safe = telegramNetworkError(original, true);
    expect(safe.message).toContain("ECONNREFUSED");
    expect(safe.message).toContain("Xray sidecar");
    expect(inspect(safe)).not.toMatch(/SECRET|PASSWORD/);
  });

  it("does not trust arbitrary error codes or expose the original message", () => {
    expect(networkErrorCode({ code: "TOKEN_MUST_NOT_LEAK", message: "secret" })).toBe("NETWORK_ERROR");
    expect(telegramNetworkError(new Error("secret"), false).message).toContain("TELEGRAM_PROXY_URL is unset");
    expect(networkErrorCode(new DOMException("secret", "TimeoutError"))).toBe("TimeoutError");
  });

  it("bounds traversal of cyclic causes", () => {
    const error: { cause?: unknown } = {};
    error.cause = error;
    expect(networkErrorCode(error)).toBe("NETWORK_ERROR");
  });
});
