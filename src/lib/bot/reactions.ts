/**
 * How the bot acknowledges a saved report: a reaction on the author's own message (silent, no
 * notification, no clutter) or a real reply. Pure — the pipeline calls `decideAck` and does the I/O.
 *
 * A reply is sent only when the message has to say something the author must act on: offer a bingo
 * (that needs a button), or explain why part of the report did not make it. Everything else — the
 * ordinary «ran 5 km, counted» — is a reaction, and the running score lives in /me and the digest.
 */

/** What `saveFromExtraction` produced, reduced to what the acknowledgement depends on. */
export type SaveOutcome = {
  /** The day already had an activity, so the report added no 🎃. */
  dayAlreadyActive: boolean;
  /** A bingo the LLM is unsure about: the reply carries the «Да, бинго» button. */
  bingoOffer: boolean;
  /** A bingo was recognised but the rules want a photo. */
  bingoNeedsPhoto: boolean;
  /** A video over Telegram's download limit was dropped from the proofs. */
  videoTooLarge: boolean;
};

export type Ack = { kind: "reaction"; emoji: string } | { kind: "reply" };

export function decideAck(o: SaveOutcome, emoji: { saved: string; alreadyCounted: string }): Ack {
  if (o.bingoOffer || o.bingoNeedsPhoto || o.videoTooLarge) return { kind: "reply" };
  return { kind: "reaction", emoji: o.dayAlreadyActive ? emoji.alreadyCounted : emoji.saved };
}
