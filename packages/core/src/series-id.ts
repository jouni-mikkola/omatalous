/**
 * The parts of a series id, `<in|out>:<account>:<merchant>` with `#habit` or `#<cents>` after it when one merchant on
 * one account has several series. Ids are stored (marks, Optimoi decisions and inputs), so the format never changes
 * (ADR 0009). An account id has no ":" and a merchant name no "#" (cleanDescription drops it), so ids from real rows
 * never need the escape below.
 *
 * Kept apart from recurring.ts, which the page's own code (format.ts) would otherwise pull in whole: the web app
 * loads this file with the entry and the series detection only with the pages that run it.
 */
export interface SeriesIdParts {
  direction: "in" | "out";
  accountId: string;
  merchant: string;
  /** `habit` for the everyday purchases, the typical cents of one of several fixed products, null for the one series. */
  product: "habit" | number | null;
}

const PRODUCT = String.raw`#(?:habit|-?[1-9]\d*|0)`;
/** A merchant that ends like a product suffix, or in "#", gets one more "#" when it has no product. */
const LOOKS_LIKE_PRODUCT = new RegExp(`(?:${PRODUCT}|#)$`, "u");
const WITH_PRODUCT = new RegExp(`^(.+?)(${PRODUCT})?$`, "su");

/** The one maker of a series id. */
export function seriesId(p: SeriesIdParts): string {
  const tail = p.product !== null ? `#${p.product}` : LOOKS_LIKE_PRODUCT.test(p.merchant) ? "#" : "";
  return `${p.direction}:${p.accountId}:${p.merchant}${tail}`;
}

/** The one reader of a series id, or null for any other subject (a merchant name, a code). */
export function parseSeriesId(id: string): SeriesIdParts | null {
  const head = /^(in|out):([^:]*):(.+)$/su.exec(id);
  if (!head) return null;
  const [, direction, accountId, rest] = head as unknown as [string, "in" | "out", string, string];
  if (rest.endsWith("#") && LOOKS_LIKE_PRODUCT.test(rest.slice(0, -1))) return { direction, accountId, merchant: rest.slice(0, -1), product: null };
  const [, merchant, suffix] = WITH_PRODUCT.exec(rest)!;
  const product = suffix === undefined ? null : suffix === "#habit" ? "habit" : Number(suffix.slice(1));
  return { direction, accountId, merchant: merchant!, product };
}

/**
 * The price in the id of a series that is one fixed-price product among several of its merchant on the account (Apple
 * 12,99 beside Apple 0,99), else null: the median of its charges, kept so that marks stay on the series. A page names
 * the product with the charge of today instead (web `seriesName`), which differs after a rise.
 */
export const productCents = (id: string): number | null => {
  const product = parseSeriesId(id)?.product;
  return typeof product === "number" ? product : null;
};
