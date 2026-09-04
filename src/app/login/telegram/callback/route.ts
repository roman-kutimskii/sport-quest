import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE, makeSessionValue } from "@/lib/auth";
import { publicOrigin } from "@/lib/origin";
import { TG_FLOW_COOKIE, type TelegramFlow, exchangeCode, isBootstrapAdmin, normalizeHandle, telegramEnabled } from "@/lib/telegram";

/**
 * Telegram OpenID Connect redirect URI.
 *
 * Anyone with a Telegram account may sign in. An account is matched by the
 * stored Telegram subject, else by a @username an organizer pre-entered, else
 * created on the spot. Usernames listed in TELEGRAM_ADMIN_USERNAMES get admin.
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
  const telegramId = identity.id;
  const handle = normalizeHandle(identity.username);
  const admin = isBootstrapAdmin(identity.username);

  let user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user && handle) {
    const candidates = await prisma.user.findMany({ where: { telegramHandle: { not: null }, telegramId: null } });
    const match = candidates.find((u) => normalizeHandle(u.telegramHandle) === handle);
    if (match) user = await prisma.user.update({ where: { id: match.id }, data: { telegramId, isAdmin: match.isAdmin || admin } });
  }
  if (user) {
    const patch: { telegramHandle?: string; isAdmin?: boolean } = {};
    if (identity.username && identity.username !== user.telegramHandle) patch.telegramHandle = identity.username;
    if (admin && !user.isAdmin) patch.isAdmin = true;
    if (Object.keys(patch).length) user = await prisma.user.update({ where: { id: user.id }, data: patch });
  } else {
    const name = (identity.name ?? identity.username ?? "Участник").trim().slice(0, 60) || "Участник";
    user = await prisma.user.create({ data: { name, telegramId, telegramHandle: identity.username ?? null, isAdmin: admin } });
    console.log(`[tg] created user ${name} (${identity.username ?? "-"})`);
  }
  if (!user.isActive) {
    console.log(`[tg] inactive user ${user.name} tried to sign in`);
    return fail("tg_inactive");
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
