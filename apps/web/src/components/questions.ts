/** The whole percent of the money that is classified, rounded down: 99,6 % is "99 %", never "100 %". */
export function classifiedPercent(share: number): number {
  // 0.29 * 100 is 28.999999999999996: the sum of cents decides, not the float's last digits
  return Math.floor(share * 100 + 1e-9);
}

/** The block is drawn when the share is told and there is something to ask or the picture is under 95 % mended. */
export function asks(questions: { share: number | null; items: readonly unknown[] }): boolean {
  return questions.share !== null && (questions.items.length > 0 || questions.share < 0.95);
}
