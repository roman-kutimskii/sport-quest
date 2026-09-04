import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, SESSION_COOKIE, makeSessionValue } from "@/lib/auth";
import { publicOrigin } from "@/lib/origin";
import { TG_FLOW_COOKIE, type TelegramFlow, exchangeCode, normalizeHandle, telegramEnabled } from "@/lib/telegram";

/**
 * Telegram OpenID Connect redirect URI.
 *
 * Rules: an account is matched by stored Telegram ID, otherwise by the
 * @username the organizer entered for the participant. A user who is already
 * signed in (via invite link) gets their Telegram linked to that account.
 * Unknown Telegram users are not created: the quest is invite-only.
 */
export async function GET(req: NextRequest) {
  const origin = publicOrigin(req);
  const fail = (code: string) => {
    const res = NextResponse.redirect(new URL(`/login?error=${code}`, origin), { status: 303 });
    res.cookies.delete({ name: TG_FLOW_COOKIE, path: "/login/telegram" });
    return res;
  };
  if (!telegramEnabled()) return fail("tg_disabled");

  const q = new URL(req.url).searchParams;
  let flow: TelegramFlow | null = null;
  try { flow = JSON.parse(req.cookies.get(TG_FLOW_COOKIE)?.value ?? "null"); } catch { flow = null; }
  const code = q.get("code");
  if (q.get("error")) { console.log(`[tg] provider error: ${q.get("error")}`); return fail("tg_invalid"); }
  if (!flow || !code || q.get("state") !== flow.state) return fail("tg_invalid");

  let identity;
  try {
    identity = await exchangeCode(code, `${origin}/login/telegram/callback`, flow);
  } catch (e) {
    console.log(`[tg] exchange failed: ${e instanceof Error ? e.message : e}`);
    return fail("tg_invalid");
  }
  const telegramId = BigInt(identity.id);
  const handle = normalizeHandle(identity.username);

  let user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    const current = await getCurrentUser();
    if (current) {
      user = await prisma.user.update({
        where: { id: current.id },
        data: { telegramId, telegramHandle: current.telegramHandle ?? identity.username ?? null },
      });
    }
  }
  if (!user && handle) {
    const candidates = await prisma.user.findMany({ where: { telegramHandle: { not: null }, telegramId: null } });
    const match = candidates.find((u) => normalizeHandle(u.telegramHandle) === handle);
    if (match) user = await prisma.user.update({ where: { id: match.id }, data: { telegramId } });
  }
  if (!user || !user.isActive) {
    console.log(`[tg] no account for telegram id=${identity.id} username=${identity.username ?? "-"}`);
    return fail("tg_unknown");
  }

  console.log(`[tg] ${user.name} signed in via Telegram`);
  const res = NextResponse.redirect(new URL("/", origin), { status: 303 });
  res.cookies.set(SESSION_COOKIE, makeSessionValue(user.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
  res.cookies.delete({ name: TG_FLOW_COOKIE, path: "/login/telegram" });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
