import { describe, expect, it } from "vitest";
import { parseRange } from "./range";

describe("parseRange", () => {
  it("returns null without a header", () => expect(parseRange(null, 100)).toBeNull());
  it("parses open-ended ranges", () => expect(parseRange("bytes=10-", 100)).toEqual({ start: 10, end: 99 }));
  it("clamps the end to the file size", () => expect(parseRange("bytes=0-500", 100)).toEqual({ start: 0, end: 99 }));
  it("parses suffix ranges", () => expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 }));
  it("rejects out-of-bounds starts", () => expect(parseRange("bytes=100-", 100)).toBe(false));
  it("rejects inverted ranges", () => expect(parseRange("bytes=50-10", 100)).toBe(false));
  it("ignores malformed headers", () => expect(parseRange("items=0-1", 100)).toBeNull());
});
