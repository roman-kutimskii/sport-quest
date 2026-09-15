import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.fn();
const requestRetry = vi.fn(async () => true);

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin }));
vi.mock("@/lib/db", () => ({ prisma: {}, ReportStatus: {} }));
vi.mock("@/lib/quest", () => ({ getActiveQuest: vi.fn() }));
vi.mock("@/lib/bot/retry", () => ({ requestRetry }));

const { retryTelegramLink } = await import("./actions");

const form = (id: string) => {
  const f = new FormData();
  f.set("id", id);
  return f;
};

describe("retryTelegramLink", () => {
  beforeEach(() => vi.clearAllMocks());

  it("re-queues the row for an admin", async () => {
    requireAdmin.mockResolvedValue({ id: "admin", isAdmin: true });
    await retryTelegramLink(form("L1"));
    expect(requestRetry).toHaveBeenCalledWith("L1");
  });

  it("does nothing for a non-admin", async () => {
    // requireAdmin redirects (throws NEXT_REDIRECT) for everyone else.
    requireAdmin.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(retryTelegramLink(form("L1"))).rejects.toThrow("NEXT_REDIRECT");
    expect(requestRetry).not.toHaveBeenCalled();
  });
});
