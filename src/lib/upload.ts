import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

const MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "video/mp4", "video/quicktime", "video/webm"]);

export function uploadDir() {
  return path.resolve(process.env.UPLOAD_DIR ?? "./uploads");
}

const MAX_FILES = 10;

/** Saves one proof file; returns public URL path or null if no file given. Throws on invalid file. */
async function saveProof(file: File | null): Promise<string | null> {
  if (!file || file.size === 0) return null;
  if (file.size > MAX_BYTES) throw new Error("Файл больше 50 МБ");
  if (!ALLOWED.has(file.type)) throw new Error("Поддерживаются только фото (jpg, png, webp, heic) и видео (mp4, mov, webm)");
  const ext = path.extname(file.name).toLowerCase().replace(/[^a-z0-9.]/g, "") || guessExt(file.type);
  const name = `${Date.now()}-${randomBytes(6).toString("hex")}${ext}`;
  await mkdir(uploadDir(), { recursive: true });
  await writeFile(path.join(uploadDir(), name), Buffer.from(await file.arrayBuffer()));
  return `/uploads/${name}`;
}

/** Saves several proof files; returns their public URL paths. Throws on invalid file. */
export async function saveProofs(files: File[]): Promise<string[]> {
  const real = files.filter((f) => f.size > 0);
  if (real.length > MAX_FILES) throw new Error(`Не больше ${MAX_FILES} файлов за раз`);
  const urls: string[] = [];
  for (const file of real) {
    const url = await saveProof(file);
    if (url) urls.push(url);
  }
  return urls;
}

function guessExt(mime: string) {
  return { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "image/heic": ".heic", "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm" }[mime] ?? "";
}

export { isVideoUrl } from "@/lib/media";
