import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; status: string; retryRequestedAt: Date | null; error: string | null };
const rows = new Map<string, Row>();

// In-memory stand-in with Postgres' conditional-update semantics for `updateMany`.
vi.mock("@/lib/db", () => ({
  TelegramLinkStatus: { RECEIVED: "RECEIVED", FAILED: "FAILED", SAVED: "SAVED", UNDONE: "UNDONE" },
  prisma: {
    telegramLink: {
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; status: string }; data: Partial<Row> }) => {
        const row = rows.get(where.id);
        if (!row || row.status !== where.status) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
  },
}));

const { requestRetry } = await import("./retry");

describe("requestRetry", () => {
  beforeEach(() => {
    rows.clear();
    rows.set("L1", { id: "L1", status: "FAILED", retryRequestedAt: null, error: "LLM HTTP 503" });
  });

  it("re-queues a failed row once; a double click changes nothing", async () => {
    const first = new Date("2026-09-15T10:00:00Z");
    expect(await requestRetry("L1", first)).toBe(true);
    expect(rows.get("L1")).toMatchObject({ status: "RECEIVED", retryRequestedAt: first, error: null });

    expect(await requestRetry("L1", new Date("2026-09-15T10:00:01Z"))).toBe(false);
    expect(rows.get("L1")?.retryRequestedAt).toEqual(first);
  });

  it("lets exactly one of two simultaneous clicks through", async () => {
    const results = await Promise.all([requestRetry("L1"), requestRetry("L1")]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it.each(["RECEIVED", "SAVED", "UNDONE"])("ignores a row in status %s", async (status) => {
    rows.set("L1", { id: "L1", status, retryRequestedAt: null, error: null });
    expect(await requestRetry("L1")).toBe(false);
    expect(rows.get("L1")?.status).toBe(status);
  });

  it("ignores an unknown id", async () => {
    expect(await requestRetry("nope")).toBe(false);
  });
});
