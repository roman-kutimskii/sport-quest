import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { uploadDir } from "@/lib/upload";
import { getCurrentUser } from "@/lib/auth";
import { parseRange } from "@/lib/range";

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
  ".heic": "image/heic", ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
};

export async function GET(req: Request, ctx: RouteContext<"/uploads/[name]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { name } = await ctx.params;
  const safe = path.basename(name);
  const file = path.join(uploadDir(), safe);

  let size: number;
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
    size = info.size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const headers: Record<string, string> = {
    "Content-Type": MIME[path.extname(safe).toLowerCase()] ?? "application/octet-stream",
    "Cache-Control": "private, max-age=86400",
    "Accept-Ranges": "bytes",
  };

  const range = parseRange(req.headers.get("range"), size);
  if (range === false) {
    return new Response("Range Not Satisfiable", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }

  const { start, end } = range ?? { start: 0, end: size - 1 };
  headers["Content-Length"] = String(end - start + 1);
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;

  const body = size === 0 ? null : (Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream);
  return new Response(body, { status: range ? 206 : 200, headers });
}
