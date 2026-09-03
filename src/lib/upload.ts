import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

const MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "video/mp4", "video/quicktime", "video/webm"]);

export function uploadDir() {
  return path.resolve(process.env.UPLOAD_DIR ?? "./uploads");
}

/** Saves a proof file; returns public URL path or null if no file given. Throws on invalid file. */
export async function saveProof(file: File | null): Promise<string | null> {
  if (!file || file.size === 0) return null;
  if (file.size > MAX_BYTES) throw new Error("Файл больше 50 МБ");
  if (!ALLOWED.has(file.type)) throw new Error("Поддерживаются только фото (jpg, png, webp, heic) и видео (mp4, mov, webm)");
  const ext = path.extname(file.name).toLowerCase().replace(/[^a-z0-9.]/g, "") || guessExt(file.type);
  const name = `${Date.now()}-${randomBytes(6).toString("hex")}${ext}`;
  await mkdir(uploadDir(), { recursive: true });
  await writeFile(path.join(uploadDir(), name), Buffer.from(await file.arrayBuffer()));
  return `/uploads/${name}`;
}

function guessExt(mime: string) {
  return { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "image/heic": ".heic", "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm" }[mime] ?? "";
}

export function isVideoUrl(url: string) {
  return /\.(mp4|mov|webm)$/i.test(url);
}
