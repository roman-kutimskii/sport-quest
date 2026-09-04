import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE, makeSessionValue } from "@/lib/auth";
import { publicOrigin } from "@/lib/origin";

function page(title: string, body: string, redirectTo?: string) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>${redirectTo ? `<meta http-equiv="refresh" content="1;url=${redirectTo}">` : ""}
<style>body{font-family:system-ui,sans-serif;background:#1a1310;color:#f6ede2;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;text-align:center}
a{display:inline-block;margin-top:20px;background:#e2711d;color:#fff;text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:600}</style></head>
<body><div><div style="font-size:56px">🎃</div><h1>${title}</h1><p>${body}</p>${redirectTo ? `<a href="${redirectTo}">Перейти к таблице</a>` : `<a href="/login">На страницу входа</a>`}</div></body></html>`;
}

export async function GET(req: NextRequest, ctx: RouteContext<"/join/[token]">) {
  const { token } = await ctx.params;
  const user = await prisma.user.findUnique({ where: { inviteToken: token } });
  const origin = publicOrigin(req);
  const ua = req.headers.get("user-agent") ?? "-";
  if (!user || !user.isActive) {
    console.log(`[join] bad token from ${ua}`);
    return new Response(page("Ссылка не подошла", "Проверь, что скопировал её целиком, или попроси новую у организатора."), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  console.log(`[join] ${user.name} via ${ua}`);
  const secure = origin.startsWith("https://");
  const cookie = [
    `${SESSION_COOKIE}=${makeSessionValue(user.id)}`,
    "Path=/",
    `Max-Age=${60 * 60 * 24 * 180}`,
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
  return new Response(page(`Привет, ${user.name}!`, "Ты вошёл в трекер. Сейчас откроется таблица лидеров.", `${origin}/`), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": cookie, "Cache-Control": "no-store" },
  });
}
