/** Keep tokens, proxy passwords, request URLs and upstream bodies out of logs. */
const NETWORK_CODES = new Set([
  "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET",
  "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DEPTH_ZERO_SELF_SIGNED_CERT",
]);

export function networkErrorCode(error: unknown): string {
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const value = current as { code?: unknown; name?: unknown; cause?: unknown };
    if (typeof value.code === "string" && NETWORK_CODES.has(value.code)) return value.code;
    if (value.name === "TimeoutError" || value.name === "AbortError") return String(value.name);
    current = value.cause;
  }
  return "NETWORK_ERROR";
}

export function telegramNetworkError(error: unknown, proxyConfigured: boolean): Error {
  return new Error(`Telegram connection failed (${networkErrorCode(error)}); ${proxyConfigured
    ? "check TELEGRAM_PROXY_URL, the Xray sidecar and US1 connectivity"
    : "TELEGRAM_PROXY_URL is unset; configure the Telegram proxy"}`);
}
