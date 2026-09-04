import { NextResponse, type NextRequest } from "next/server";
import { publicOrigin } from "@/lib/origin";
import { TG_FLOW_COOKIE, buildAuthUrl, newFlow, telegramEnabled } from "@/lib/telegram";

/** Starts the Telegram OpenID Connect flow. */
export async function GET(req: NextRequest) {
  const origin = publicOrigin(req);
  if (!telegramEnabled()) return NextResponse.redirect(new URL("/login?error=tg_disabled", origin), { status: 303 });
  const flow = newFlow();
  const res = NextResponse.redirect(buildAuthUrl(flow, `${origin}/login/telegram/callback`), { status: 303 });
  res.cookies.set(TG_FLOW_COOKIE, JSON.stringify(flow), {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: "/login/telegram",
    maxAge: 60 * 10,
  });
  return res;
}
