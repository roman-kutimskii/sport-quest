import { NextResponse, type NextRequest } from "next/server";
import { publicOrigin } from "@/lib/origin";
import { SESSION_COOKIE } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/", publicOrigin(req)));
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
