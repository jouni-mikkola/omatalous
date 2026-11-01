/** The Finnish words the Optimoi page shows for a core code, and the names of findings and series. */
import { type AreaView, type DismissReason, type EuroRange, joinRange, parseFindingId } from "@banking/core";
import { money, seriesName } from "../../format.ts";
import { t } from "../../text.ts";

/** Called after something was saved; the page fetches again and says what happened. */
export type Changed = (message: string) => void;

/** The four answers to Ei koske meitä, as the household reads them. */
export const reasonText = (reason: DismissReason): string => t(`ow.reason_${reason}`);

/** "2 100–3 600 €", or null when the range is one figure at the precision the page shows. */
export function rangeText(e: Pick<EuroRange, "lowCents" | "highCents">): string | null {
  const low = money(e.lowCents, false);
  const high = money(e.highCents, false);
  return low === high ? null : joinRange(low, high);
}

/** The name of a recurring series id (`out:<account>:<merchant>#1299`), as every page says it; any other subject is returned as it is. */
export function subjectName(subject: string): string {
  return seriesName(subject) ?? subject;
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
