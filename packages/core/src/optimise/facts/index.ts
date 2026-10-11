/**
 * Dated outside figures (reference rates, CPI, price lists, laws). A national figure enters a finding only from a row
 * here, and a row past its expiry hides its comparison, so the page never compares against an old number. Each row
 * was read from its source page on `verifiedAt`; a figure nobody opened at its source is left out.
 */
import { addMonthsToDate } from "../../dates.ts";
import type { IsoDate } from "../../types.ts";
import { BANK_FACTS } from "./bank.ts";
import { ELECTRICITY_FACTS } from "./electricity.ts";
import { GENERAL_FACTS } from "./general.ts";
import { HOUSING_FACTS } from "./housing.ts";
import { KIDS_FACTS } from "./kids.ts";
import { LOANS_FACTS } from "./loans.ts";
import { SAVINGS_FACTS } from "./savings.ts";
import { TAX_FACTS } from "./tax.ts";

/**
 * The expiry class of a row: rates, CPI and energy prices age in 6 months from `asOf`; price lists, surveys and
 * sample offers in 12; a law at its `validTo`, else 12 months after it was verified.
 */
export type FactKind = "rate" | "cpi" | "energy" | "price_list" | "survey" | "sample" | "law";

export type FactStatus = "valid" | "proposed" | "repealed";

export interface Fact {
  /** Several rows may share an id with different validity (a fee before and after a change). */
  id: string;
  /** Finnish, as a calc line shows it. */
  label: string;
  value: number;
  /** "%", "c/kWh", "snt" (money facts are in cents), "€/kk" in a value cell only. */
  unit: string;
  kind: FactKind;
  status: FactStatus;
  validFrom: IsoDate;
  validTo?: IsoDate;
  /** The month a statistic measures (CPI of 2026-08); `asOf` is then the release the series was read from. */
  period?: string;
  /** The date the figure describes. */
  asOf: IsoDate;
  /** `factExpiry` of the row: the test checks it. */
  expires: IsoDate;
  source: { title: string; url: string };
  /** The day a worker opened `source.url` and read the figure there. */
  verifiedAt: IsoDate;
}

/** The expiry rule of the plan. */
export function factExpiry(f: Pick<Fact, "kind" | "asOf" | "validTo" | "verifiedAt">): IsoDate {
  switch (f.kind) {
    case "rate":
    case "cpi":
    case "energy":
      return addMonthsToDate(f.asOf, 6);
    case "price_list":
    case "survey":
    case "sample":
      return addMonthsToDate(f.asOf, 12);
    case "law":
      return f.validTo ?? addMonthsToDate(f.verifiedAt, 12);
  }
}

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

/** The valid row of `id` on `today` from `rows`; null when none is valid, in force and unexpired. */
export function factFrom(rows: readonly Fact[], id: string, today: IsoDate): Fact | null {
  return latest(rows.filter((f) => f.id === id && f.status === "valid" && f.validFrom <= today && (!f.validTo || today <= f.validTo) && today <= f.expires));
}

/** A proposed row of `id` that has not expired: shown only as a calc line ("Jos esitys hyväksytään: 520 €"), never in euros. */
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
