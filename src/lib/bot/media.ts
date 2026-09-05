/** Downloads Telegram media into UPLOAD_DIR as proof files and picks small images for the LLM. */
import { saveProofBytes } from "@/lib/upload";
import { LIMITS } from "./config";
import type { TelegramApi, TgMessage, TgPhotoSize } from "./telegram-api";

export type Downloaded = { url: string; mime: string; data: Buffer };
export type LlmImage = { mime: string; data: Buffer };

const LLM_MAX_WIDTH = 800;
const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
};

export function mimeFromFilePath(filePath: string | undefined, fallback?: string): string | null {
  const ext = filePath?.split(".").pop()?.toLowerCase();
  return (ext && EXT_MIME[ext]) ?? fallback ?? null;
}

/** Largest photo size (the proof) and the largest size with width ≤ 800 px (for the LLM; smallest if none). */
export function pickPhotoSizes(sizes: TgPhotoSize[]): { proof: TgPhotoSize; llm: TgPhotoSize } {
  const sorted = [...sizes].sort((a, b) => a.width * a.height - b.width * b.height);
  const proof = sorted[sorted.length - 1];
  const small = sorted.filter((s) => s.width <= LLM_MAX_WIDTH);
  const llm = small.length ? small[small.length - 1] : sorted[0];
  return { proof, llm };
}

async function fetchFile(api: TelegramApi, fileId: string, fallbackMime?: string): Promise<{ data: Buffer; mime: string } | null> {
  const file = await api.getFile(fileId);
  if (!file.file_path) return null;
  const mime = mimeFromFilePath(file.file_path, fallbackMime);
  if (!mime) return null;
  return { data: await api.downloadFile(file.file_path), mime };
}

const isImageMime = (m: string) => m.startsWith("image/");
const isVideoMime = (m: string | undefined) => !!m && m.startsWith("video/");

/**
 * Photo: largest size → proof; ≤800 px size → LLM image (downloaded once when both are the same size).
 * Video / video document: downloaded as proof if ≤ 20 MB, else `tooLarge`; thumbnail → LLM image.
 * The caller enforces LIMITS.maxPhotos across an album.
 */
export async function saveTelegramMedia(api: TelegramApi, m: TgMessage): Promise<{ proofUrls: string[]; images: LlmImage[]; tooLarge: boolean }> {
  const proofUrls: string[] = [];
  const images: LlmImage[] = [];
  let tooLarge = false;

  if (m.photo?.length) {
    const { proof, llm } = pickPhotoSizes(m.photo);
    const full = await fetchFile(api, proof.file_id);
    if (full) {
      proofUrls.push(await saveProofBytes(full.data, full.mime));
      if (llm.file_id === proof.file_id) images.push({ mime: full.mime, data: full.data });
      else {
        const small = await fetchFile(api, llm.file_id);
        images.push(small ? { mime: small.mime, data: small.data } : { mime: full.mime, data: full.data });
      }
    }
  }

  const video = m.video ?? (isVideoMime(m.document?.mime_type) ? m.document : undefined);
  if (video) {
    if (video.file_size !== undefined && video.file_size > LIMITS.videoMaxBytes) tooLarge = true;
    else {
      try {
        const file = await fetchFile(api, video.file_id, video.mime_type ?? "video/mp4");
        if (file) proofUrls.push(await saveProofBytes(file.data, file.mime));
      } catch (e) {
        // Telegram refuses getFile for files > 20 MB ("file is too big") when file_size was absent.
        if (/too big/i.test(e instanceof Error ? e.message : String(e))) tooLarge = true;
        else throw e;
      }
    }
    if (video.thumbnail) {
      const thumb = await fetchFile(api, video.thumbnail.file_id, "image/jpeg");
      if (thumb && isImageMime(thumb.mime)) images.push({ mime: thumb.mime, data: thumb.data });
    }
  } else if (m.document && isImageMime(m.document.mime_type ?? "")) {
    // Uncompressed image sent as a file: proof only via its own bytes, LLM gets the thumbnail if present.
    const file = await fetchFile(api, m.document.file_id, m.document.mime_type);
    if (file && isImageMime(file.mime)) {
      proofUrls.push(await saveProofBytes(file.data, file.mime));
      const thumb = m.document.thumbnail ? await fetchFile(api, m.document.thumbnail.file_id, "image/jpeg") : null;
      images.push(thumb ? { mime: thumb.mime, data: thumb.data } : { mime: file.mime, data: file.data });
    }
  }

  return { proofUrls, images, tooLarge };
}
