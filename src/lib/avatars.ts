/** Suggested avatars for the picker; any single emoji is accepted too. */
export const AVATAR_EMOJIS = [
  "🏃", "🚶", "🚴", "🏊", "🧘", "🏋️", "⛹️", "🤸", "⛷️", "🥊",
  "🦊", "🐻", "🦉", "🐺", "🦌", "🐿️", "🦔", "🐢", "🐝", "🐙",
  "🎃", "🍂", "🍁", "🌰", "🍄", "☕", "🔥", "⭐", "🌙", "🦄",
];

const graphemes = new Intl.Segmenter("ru", { granularity: "grapheme" });

/** True when the string is exactly one emoji grapheme (so names/letters are rejected). */
export function isSingleEmoji(value: string) {
  const parts = [...graphemes.segment(value)];
  return parts.length === 1 && /\p{Extended_Pictographic}/u.test(value);
}
