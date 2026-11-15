import { hashOf } from "../../routes.ts";

/** A page of Raportit by its question (`?q=`). */
export const reportHref = (q: string) => hashOf({ page: "reports", params: new URLSearchParams({ q }) });

/** The length of a bar as a share of its scale, a tenth of a percent at most and held inside the track. Only a length: the sums are the answer's own. */
export const percentOf = (part: number, whole: number) => `${whole > 0 ? Math.round(Math.min(1, Math.max(0, part / whole)) * 1000) / 10 : 0}%`;

/** The length of a stretch between two points of a scale, as a share of the scale: a band, not a sum. */
export const percentBetween = (from: number, to: number, whole: number) => percentOf(to - from, whole);
