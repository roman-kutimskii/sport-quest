import { NextResponse, type NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const raw = (url.searchParams.get("token") ?? "").trim();
  const token = raw.includes("/join/") ? raw.split("/join/")[1].split(/[?#]/)[0] : raw;
  return NextResponse.redirect(new URL(`/join/${encodeURIComponent(token)}`, url.origin));
}
