/** The Finnish words the Optimoi page shows for a core code, and the names of findings and series. */
import { type AreaView, type DismissReason, type Effort, type EuroRange, parseFindingId, parseSeriesId } from "@banking/core";
import { money } from "../../format.ts";

/** Called after something was saved; the page fetches again and says what happened. */
export type Changed = (message: string) => void;

export const EFFORT_TEXT: Record<Effort, string> = { minuutteja: "Kestää minuutteja", tunti: "Kestää tunnin", ilta: "Vie illan" };

/** The four answers to Ei koske meitä, as the household reads them. */
export const REASON_TEXT: Record<DismissReason, string> = {
  need_it: "Tarvitsen tämän",
  compared: "Olen jo kilpailuttanut",
  wrong: "Arvio on väärä",
  cannot: "En voi vaikuttaa",
};

/** "2 100–3 600 €", or null when the range is one figure at the precision the page shows. */
export function rangeText(e: Pick<EuroRange, "lowCents" | "highCents">): string | null {
  const low = money(e.lowCents, false);
  const high = money(e.highCents, false);
  return low === high ? null : `${low.replace(/\s€$/, "")}–${high}`;
}

/** The merchant of a recurring series id (`out:<account>:<merchant>#habit`); any other subject is returned as it is. */
export function subjectName(subject: string): string {
  return parseSeriesId(subject)?.merchant ?? subject;
}

/**
 * The words for a decision whose finding is not on the page (done and gone from the data, or snoozed): its area, and the
 * merchant when the id holds a series. Any other subject is a code ("video"), not words, so it is left out.
 */
export function nameOf(id: string, areas: readonly AreaView[]): string {
  const parts = parseFindingId(id);
  if (!parts) return id;
  const area = areas.find((a) => a.id === parts.area)?.label ?? parts.area;
  const merchant = parts.subject ? subjectName(parts.subject) : null;
  return merchant && merchant !== parts.subject ? `${area}: ${merchant}` : area;
}
