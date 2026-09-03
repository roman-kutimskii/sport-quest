import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE, makeSessionValue } from "@/lib/auth";

export async function GET(req: NextRequest, ctx: RouteContext<"/join/[token]">) {
  const { token } = await ctx.params;
  const user = await prisma.user.findUnique({ where: { inviteToken: token } });
  const url = new URL(req.url);
  if (!user || !user.isActive) {
    return NextResponse.redirect(new URL("/login?error=bad-token", url.origin));
  }
  const res = NextResponse.redirect(new URL("/", url.origin));
  res.cookies.set(SESSION_COOKIE, makeSessionValue(user.id), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
  return res;
}
