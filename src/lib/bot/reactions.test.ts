import { describe, expect, it } from "vitest";
import { decideAck, type SaveOutcome } from "./reactions";

const EMOJI = { saved: "🔥", alreadyCounted: "👌" };
const plain: SaveOutcome = { dayAlreadyActive: false, bingoOffer: false, bingoNeedsPhoto: false, videoTooLarge: false };

describe("decideAck", () => {
  it("acknowledges an ordinary save with a reaction", () => {
    expect(decideAck(plain, EMOJI)).toEqual({ kind: "reaction", emoji: "🔥" });
  });

  it("uses a different reaction when the day was already counted", () => {
    expect(decideAck({ ...plain, dayAlreadyActive: true }, EMOJI)).toEqual({ kind: "reaction", emoji: "👌" });
  });

  it("replies when the message has to carry the bingo button", () => {
    expect(decideAck({ ...plain, bingoOffer: true }, EMOJI)).toEqual({ kind: "reply" });
  });

  it("replies when something has to be explained", () => {
    expect(decideAck({ ...plain, bingoNeedsPhoto: true }, EMOJI)).toEqual({ kind: "reply" });
    expect(decideAck({ ...plain, videoTooLarge: true }, EMOJI)).toEqual({ kind: "reply" });
  });

  it("prefers a reply over a reaction when both apply", () => {
    expect(decideAck({ ...plain, dayAlreadyActive: true, bingoOffer: true }, EMOJI)).toEqual({ kind: "reply" });
  });
});
