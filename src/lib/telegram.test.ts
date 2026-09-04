import { describe, expect, it } from "vitest";
import { buildAuthUrl, codeChallenge, newFlow, normalizeHandle } from "./telegram";

describe("telegram oidc helpers", () => {
  it("computes an S256 PKCE challenge (RFC 7636 appendix B)", () => {
    expect(codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("builds an authorization URL with all required params", () => {
    process.env.TELEGRAM_CLIENT_ID = "12345";
    const flow = newFlow();
    const u = new URL(buildAuthUrl(flow, "https://example.com/login/telegram/callback"));
    expect(u.origin + u.pathname).toBe("https://oauth.telegram.org/auth");
    const p = u.searchParams;
    expect(p.get("client_id")).toBe("12345");
    expect(p.get("response_type")).toBe("code");
    expect(p.get("scope")).toBe("openid profile");
    expect(p.get("state")).toBe(flow.state);
    expect(p.get("nonce")).toBe(flow.nonce);
    expect(p.get("code_challenge")).toBe(codeChallenge(flow.verifier));
    expect(p.get("code_challenge_method")).toBe("S256");
  });

  it("normalizes handles", () => {
    expect(normalizeHandle("@Roma")).toBe("roma");
    expect(normalizeHandle("https://t.me/Roma")).toBe("roma");
    expect(normalizeHandle("  ")).toBeNull();
  });
});
