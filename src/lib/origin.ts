import type { NextRequest } from "next/server";

/** Public origin of the request, honoring reverse-proxy headers (Caddy sets X-Forwarded-*). */
export function publicOrigin(req: NextRequest) {
  const h = req.headers;
  const proto = h.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? new URL(req.url).host;
  return `${proto}://${host}`;
}
