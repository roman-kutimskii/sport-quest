import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { ProxyAgent, fetch as undiciFetch } from "undici";

/**
 * Telegram Login via OpenID Connect (Authorization Code + PKCE).
 * https://core.telegram.org/bots/telegram-login
 */
export const TG_ISSUER = "https://oauth.telegram.org";
export const TG_AUTH_URL = `${TG_ISSUER}/auth`;
export const TG_TOKEN_URL = `${TG_ISSUER}/token`;

/**
 * Telegram is unreachable from the production host (blocked at ISP level), so
 * the two server-to-server calls go through an outbound HTTP proxy when
 * TELEGRAM_PROXY_URL is set. Nothing else in the app uses the proxy.
 */
const proxyUrl = process.env.TELEGRAM_PROXY_URL;
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
const tgFetch = (url: string, init?: Parameters<typeof undiciFetch>[1]) =>
  undiciFetch(url, { ...init, dispatcher }) as unknown as Promise<Response>;

const TG_JWKS = createRemoteJWKSet(new URL(`${TG_ISSUER}/.well-known/jwks.json`), {
  [customFetch]: (url, opts) => tgFetch(url, { method: opts.method, headers: opts.headers, signal: opts.signal }),
});

export const clientId = () => process.env.TELEGRAM_CLIENT_ID ?? "";
export const clientSecret = () => process.env.TELEGRAM_CLIENT_SECRET ?? "";
export const telegramEnabled = () => !!clientId() && !!clientSecret();

/** Name of the short-lived cookie holding state / PKCE verifier / nonce between redirects. */
export const TG_FLOW_COOKIE = "sq_tg_flow";

export type TelegramFlow = { state: string; verifier: string; nonce: string };

export function newFlow(): TelegramFlow {
  const rnd = () => randomBytes(32).toString("base64url");
  return { state: rnd(), verifier: rnd(), nonce: rnd() };
}

export function codeChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function buildAuthUrl(flow: TelegramFlow, redirectUri: string) {
  const u = new URL(TG_AUTH_URL);
  u.search = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid profile",
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: codeChallenge(flow.verifier),
    code_challenge_method: "S256",
  }).toString();
  return u.toString();
}

export type TelegramIdentity = { id: string; username?: string; name?: string; picture?: string };

export async function exchangeCode(code: string, redirectUri: string, flow: TelegramFlow): Promise<TelegramIdentity> {
  const res = await tgFetch(TG_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId()}:${clientSecret()}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId(),
      code_verifier: flow.verifier,
    }).toString(),
  });
  if (!res.ok) throw new Error(`token endpoint ${res.status}: ${(await res.text()).slice(0, 200)}`);
  // Telegram returns errors with HTTP 200, e.g. {"error":"invalid_grant"}.
  const body = (await res.json()) as { id_token?: string; error?: string; error_description?: string };
  if (body.error) throw new Error(`token endpoint error: ${body.error} ${body.error_description ?? ""}`.trim());
  if (!body.id_token) throw new Error("no id_token in token response");
  const id_token = body.id_token;

  const { payload } = await jwtVerify(id_token, TG_JWKS, {
    issuer: TG_ISSUER,
    audience: clientId(),
    algorithms: ["RS256", "ES256", "EdDSA", "ES256K"],
  });
  if (payload.nonce !== flow.nonce) throw new Error("nonce mismatch");
  if (typeof payload.sub !== "string" || !/^\d+$/.test(payload.sub)) throw new Error("bad sub");
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  return { id: payload.sub, username: str(payload.preferred_username), name: str(payload.name), picture: str(payload.picture) };
}

export function normalizeHandle(raw: string | null | undefined) {
  const h = (raw ?? "").trim().replace(/^@/, "").replace(/^https?:\/\/t\.me\//i, "");
  return h ? h.toLowerCase() : null;
}
