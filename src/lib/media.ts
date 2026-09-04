// Client-safe helpers; `@/lib/upload` pulls in node:fs and must stay server-only.
export function isVideoUrl(url: string) {
  return /\.(mp4|mov|webm)$/i.test(url);
}
