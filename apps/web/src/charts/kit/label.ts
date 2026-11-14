/** A name set at the end of a bar or a line, cut to `maxChars` characters with an ellipsis, so it never runs out of its room. */
export function fitLabel(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return maxChars < 2 ? "" : `${text.slice(0, maxChars - 1)}…`;
}
