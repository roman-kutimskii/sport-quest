import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { publicOrigin } from "@/lib/origin";

// POST only: a GET route would be triggered by link prefetching and log users out.
export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/", publicOrigin(req)), { status: 303 });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
