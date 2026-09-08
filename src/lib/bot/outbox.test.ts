import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("@/lib/db", () => {
  class PrismaClientKnownRequestError extends Error {
    code: string;
    constructor(message: string, opts: { code: string }) {
      super(message);
      this.code = opts.code;
    }
  }
  return { prisma: { outbox: { create } }, Prisma: { PrismaClientKnownRequestError } };
});

const { enqueueDigest, enqueueText } = await import("./outbox");
const { Prisma } = await import("@/lib/db");

describe("enqueue helpers", () => {
  beforeEach(() => create.mockReset());

  it("enqueueText creates a TEXT row", async () => {
    create.mockResolvedValue({});
    await enqueueText("-100", "привет", 7, "k1");
    expect(create).toHaveBeenCalledWith({ data: { kind: "TEXT", chatId: "-100", threadId: 7, payload: { text: "привет" }, dedupeKey: "k1" } });
    await enqueueText("-100", "hi");
    expect(create).toHaveBeenLastCalledWith({ data: { kind: "TEXT", chatId: "-100", threadId: null, payload: { text: "hi" }, dedupeKey: null } });
  });

  it("enqueueDigest dedupes weekly runs, not manual ones", async () => {
    create.mockResolvedValue({});
    await enqueueDigest("2026-W37", "-100", null);
    expect(create).toHaveBeenCalledWith({
      data: { kind: "DIGEST", chatId: "-100", threadId: null, payload: { periodKey: "2026-W37", manual: false }, dedupeKey: "digest:2026-W37" },
    });
    await enqueueDigest("2026-W37", "-100", 5, { manual: true });
    expect(create).toHaveBeenLastCalledWith({
      data: { kind: "DIGEST", chatId: "-100", threadId: 5, payload: { periodKey: "2026-W37", manual: true }, dedupeKey: null },
    });
  });

  it("swallows unique violations, rethrows others", async () => {
    create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }));
    await expect(enqueueDigest("2026-W37", "-100", null)).resolves.toBeUndefined();
    create.mockRejectedValueOnce(new Error("boom"));
    await expect(enqueueText("-100", "x")).rejects.toThrow("boom");
  });
});
