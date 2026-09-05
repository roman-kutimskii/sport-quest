import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mimeFromFilePath, pickPhotoSizes, saveTelegramMedia } from "./media";
import type { TelegramApi, TgMessage, TgPhotoSize } from "./telegram-api";

const sizes: TgPhotoSize[] = [
  { file_id: "s", file_unique_id: "us", width: 90, height: 120 },
  { file_id: "m", file_unique_id: "um", width: 320, height: 427 },
  { file_id: "x", file_unique_id: "ux", width: 800, height: 1067 },
  { file_id: "y", file_unique_id: "uy", width: 1280, height: 1707 },
];

describe("pickPhotoSizes", () => {
  it("largest for proof, largest ≤800 for the LLM", () => {
    expect(pickPhotoSizes(sizes)).toMatchObject({ proof: { file_id: "y" }, llm: { file_id: "x" } });
    expect(pickPhotoSizes([sizes[3]])).toMatchObject({ proof: { file_id: "y" }, llm: { file_id: "y" } });
  });
  it("mime from file_path with fallback", () => {
    expect(mimeFromFilePath("photos/file_1.jpg")).toBe("image/jpeg");
    expect(mimeFromFilePath("videos/file_2.MOV")).toBe("video/quicktime");
    expect(mimeFromFilePath("documents/file_3.bin", "video/mp4")).toBe("video/mp4");
    expect(mimeFromFilePath(undefined)).toBeNull();
  });
});

function stubApi() {
  const downloads: string[] = [];
  const api = {
    async getFile(fileId: string) {
      return { file_id: fileId, file_path: fileId === "v" ? "videos/file_9.mp4" : `photos/${fileId}.jpg` };
    },
    async downloadFile(filePath: string) {
      downloads.push(filePath);
      return Buffer.from(`data:${filePath}`);
    },
  } as unknown as TelegramApi;
  return { api, downloads };
}

describe("saveTelegramMedia", () => {
  let dir: string;
  const prev = process.env.UPLOAD_DIR;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sq-media-"));
    process.env.UPLOAD_DIR = dir;
  });
  afterEach(async () => {
    process.env.UPLOAD_DIR = prev;
    await rm(dir, { recursive: true, force: true });
  });

  const base = { message_id: 1, date: 0, chat: { id: 1, type: "supergroup" } };

  it("downloads proof and LLM sizes separately", async () => {
    const { api, downloads } = stubApi();
    const r = await saveTelegramMedia(api, { ...base, photo: sizes } as TgMessage);
    expect(downloads).toEqual(["photos/y.jpg", "photos/x.jpg"]);
    expect(r.proofUrls).toHaveLength(1);
    expect(r.proofUrls[0]).toMatch(/^\/uploads\/\d+-[0-9a-f]{12}\.jpg$/);
    expect(r.images[0].data.toString()).toBe("data:photos/x.jpg");
    expect(r.tooLarge).toBe(false);
    expect(await readdir(dir)).toHaveLength(1);
  });

  it("downloads once when proof and LLM sizes coincide", async () => {
    const { api, downloads } = stubApi();
    const r = await saveTelegramMedia(api, { ...base, photo: [sizes[2]] } as TgMessage);
    expect(downloads).toEqual(["photos/x.jpg"]);
    expect(r.images[0].data.toString()).toBe("data:photos/x.jpg");
  });

  it("marks big videos tooLarge and still uses the thumbnail", async () => {
    const { api, downloads } = stubApi();
    const r = await saveTelegramMedia(api, { ...base, video: { file_id: "v", file_size: 25 * 1024 * 1024, mime_type: "video/mp4", thumbnail: sizes[1] } } as TgMessage);
    expect(r.tooLarge).toBe(true);
    expect(r.proofUrls).toEqual([]);
    expect(downloads).toEqual(["photos/m.jpg"]);
    expect(r.images).toHaveLength(1);
  });

  it("saves small videos as proof", async () => {
    const { api } = stubApi();
    const r = await saveTelegramMedia(api, { ...base, video: { file_id: "v", file_size: 1024, mime_type: "video/mp4" } } as TgMessage);
    expect(r.proofUrls[0]).toMatch(/\.mp4$/);
    expect(r.images).toEqual([]);
  });
});
