import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { uploadDir } from "@/lib/upload";
import { getCurrentUser } from "@/lib/auth";

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
  ".heic": "image/heic", ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
};

export async function GET(_req: Request, ctx: RouteContext<"/uploads/[name]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { name } = await ctx.params;
  const safe = path.basename(name);
  const file = path.join(uploadDir(), safe);
  try {
    await stat(file);
    const data = await readFile(file);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": MIME[path.extname(safe).toLowerCase()] ?? "application/octet-stream",
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
