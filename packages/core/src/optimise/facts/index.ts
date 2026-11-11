/**
 * Dated outside figures (reference rates, CPI, price lists, laws). A national figure enters a finding only from a row
 * here, and a row past its expiry hides its comparison, so the page never compares against an old number. Each row
 * was read from its source page on `verifiedAt`; a figure nobody opened at its source is left out.
 */
import { DEFAULT_LANGUAGE, type Language } from "../../locale.ts";
import { factFrom } from "../../analysis/cpi.ts";
import type { Fact, IsoDate } from "../../types.ts";
import { BANK_FACTS } from "./bank.ts";
import { ELECTRICITY_FACTS } from "./electricity.ts";
import { GENERAL_FACTS } from "./general.ts";
import { HOUSING_FACTS } from "./housing.ts";
import { KIDS_FACTS } from "./kids.ts";
import { LOANS_FACTS } from "./loans.ts";
import { SAVINGS_FACTS } from "./savings.ts";
import { TAX_FACTS } from "./tax.ts";

export type { Fact } from "../../types.ts";

/** The label of `f` in `lang`. */
export const factLabel = (f: Pick<Fact, "label" | "labelEn">, lang: Language = DEFAULT_LANGUAGE): string => (lang === "en" ? (f.labelEn ?? f.label) : f.label);

/** A survey or a sample stands for other households, not this one: a certainty step (rule 7). */
export const isSampleFact = (f: Pick<Fact, "kind">) => f.kind === "survey" || f.kind === "sample";

export const FACTS: readonly Fact[] = [
  ...GENERAL_FACTS,
  ...LOANS_FACTS,
  ...SAVINGS_FACTS,
  ...BANK_FACTS,
  ...ELECTRICITY_FACTS,
  ...HOUSING_FACTS,
  ...TAX_FACTS,
  ...KIDS_FACTS,
];

const latest = (rows: Fact[]) => rows.sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0] ?? null;

export { factFrom };

/** A proposed row of `id` that has not expired: shown only as a calc line ("Jos eduskunta hyväksyy esityksen: 520 €"), never in euros. */
export function proposedFrom(rows: readonly Fact[], id: string, today: IsoDate): Fact | null {
  return latest(rows.filter((f) => f.id === id && f.status === "proposed" && today <= f.expires));
}

/** `factFrom` over every row. A null fact hides its comparison ("Vertailutieto on vanhentunut"). */
export function factOn(id: string, today: IsoDate): Fact | null {
  return factFrom(FACTS, id, today);
}

export function proposedFact(id: string, today: IsoDate): Fact | null {
  return proposedFrom(FACTS, id, today);
}

/** The year-on-year change of consumer prices in `month` (YYYY-MM), in percent, or null without a valid row. */
export function cpiChange(month: string, today: IsoDate): number | null {
  return factOn(`cpi_yoy:${month}`, today)?.value ?? null;
}
