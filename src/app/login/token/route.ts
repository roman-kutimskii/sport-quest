import { NextResponse, type NextRequest } from "next/server";
import { publicOrigin } from "@/lib/origin";

export async function GET(req: NextRequest) {
  const origin = publicOrigin(req);
  const raw = (new URL(req.url).searchParams.get("token") ?? "").trim();
  const token = raw.includes("/join/") ? raw.split("/join/")[1].split(/[?#]/)[0] : raw;
  return NextResponse.redirect(new URL(`/join/${encodeURIComponent(token)}`, origin));
}
