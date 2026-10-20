/** Over this share of the spending unitemised, a conclusion drawn from it is only a direction. */
export const UNKNOWN_SHARE_LIMIT = 0.2;

/** The percent to print, or null while the unknown share is not over the limit. */
export function unknownPercent(share: number): number | null {
  return share > UNKNOWN_SHARE_LIMIT ? Math.round(share * 100) : null;
}
