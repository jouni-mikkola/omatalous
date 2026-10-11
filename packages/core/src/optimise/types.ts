/**
 * Optimoi: the household's decisions, each with a price in euros a year or a deadline, computed from its own history.
 * These types are the contract between the frame (`index.ts`), the thirteen areas (`areas/*.ts`), the server (stored
 * inputs and states) and the page. Money is integer cents, dates are YYYY-MM-DD.
 */
import type { AnalysisContext } from "../analysis/context.ts";
import type { QualitySignal } from "../analysis/data-quality.ts";
import type { BalanceInput, IsoDate, UserInputs } from "../types.ts";
import type { FollowUp } from "./outcome.ts";
import type { FindingChange } from "./snapshot.ts";

export const AREA_IDS = ["loans", "savings", "subscriptions", "bank", "electricity", "housing", "insurance", "food", "habits", "seasons", "tax", "kids", "car"] as const;
export type AreaId = (typeof AREA_IDS)[number];

/** What a decision takes: a few minutes, an hour, an evening. */
export type Effort = "minuutteja" | "tunti" | "ilta";

/** The verbs an action may start with (rule 5): a sinä imperative the household can carry out. */
export const ACTION_VERBS = ["kilpailuta", "irtisano", "neuvottele", "vaihda", "hae", "maksa", "siirrä", "varaa", "tarkista"] as const;

/** Yearly cents, `lowCents <= midCents <= highCents`, positive. `assumption` is one Finnish sentence. */
export interface EuroRange {
  lowCents: number;
  midCents: number;
  highCents: number;
  assumption: string;
}

/** One row of the Laskelma table. Every number of a finding's title is in one of these (rule 5). */
export interface CalcLine {
  label: string;
  /** Formatted for the page: "1 234 €", "3,5 c/kWh", "12.3.2026". */
  value: string;
  /** A one-off taken out of the level, shown struck through. */
  struck?: boolean;
}

export type CertaintyLevel = "korkea" | "keskitaso" | "matala";

/** One step down in certainty (rule 7). The first in `WEAKNESS_ORDER` names the reason. */
export type WeaknessId =
  | "short_history"
  | "estimate"
  | "sample"
  | "gap"
  | "stale"
  | "own_unconnected"
  | "uncategorised"
  | "uncertain_rows"
  | "wide_range";

export interface Weakness {
  id: WeaknessId;
  /** One Finnish sentence shown as the certainty reason when this weakness comes first. */
  reason: string;
}

export interface Certainty {
  level: CertaintyLevel;
  reason: string;
}

/**
 * What a finding is about, so the follow-up can measure it after a change (`baselineOf`, O9's `outcomeOf`).
 * - series: recurring series ids (`RecurringSeries.id`)
 * - merchants: merchant names
 * - category: category ids
 * - season: category ids, the months are the finding's subject; an empty list means all spending
 * - unit: merchant names of bills that a typed quantity divides (electricity per kWh)
 * - none: nothing to measure (a deadline)
 */
export interface Measure {
  kind: "series" | "merchants" | "category" | "season" | "unit" | "none";
  keys: readonly string[];
  /** Charges a year (12 monthly, 4 quarterly, 1 yearly), so the follow-up knows how long one cycle is. */
  perYear?: number;
}

/**
 * What an area returns. The frame turns it into a `Finding`: it adds the weaknesses it can see (history, evidence
 * accounts, categories, range), works out the certainty, applies the gate and the user's states.
 */
export interface FindingDraft {
  /** `findingId(area, kind, subject)`: `<area>:<kind>` or `<area>:<kind>:<subject>`. Stored with the user's state. */
  id: string;
  area: AreaId;
  kind: string;
  /** A recurring series id or a merchant name; null for a finding about the whole household. */
  subject: string | null;
  /** At most two sentences, number first, basis after; a merchant stands in nominative before a colon. */
  title: string;
  /** A sinä imperative starting with one of `ACTION_VERBS`, capitalised. */
  action: string;
  effort: Effort;
  /** Null for a deadline finding. */
  euros: EuroRange | null;
  /** The last day to act; null when there is no deadline. */
  decideBy: IsoDate | null;
  /** The area's own weaknesses (an estimate, a sample fact). The frame adds the rest. */
  weaknesses: readonly Weakness[];
  /** A yhtiökokous or two people decide: shown, never summed in the headline. */
  shared: boolean;
  calc: readonly CalcLine[];
  /** Ids of the evidence transactions, at most 60, all in the context, no transfer. */
  rows: readonly string[];
  /** The subset of `rows` taken out of the level as one-offs. */
  struck: readonly string[];
  /** Overlap keys: `series:<id>`, `merchant:<name>`, `category:<id>`. The headline skips a finding sharing over half. */
  claims: readonly string[];
  measure: Measure;
  /** Input keys (`electricity_kwh`, `insurance_quote:<series id>`) that would make the finding exact: "Tarkenna". */
  needs?: readonly string[];
  /** Ids of the facts the comparison used. */
  facts: readonly string[];
}

/** A finding as the page gets it. */
export interface Finding extends Omit<FindingDraft, "weaknesses"> {
  certainty: Certainty;
  /** Every weakness the certainty counted, area's and frame's, in `WEAKNESS_ORDER`. */
  weaknesses: readonly Weakness[];
  /** A dismissed finding that came back because its mid grew over 50 % and over 100 €. */
  reopened?: boolean;
}

export type CheckStatus = "finding" | "clear" | "needs_input" | "no_data";

/**
 * One thing an area looked at: "Tarkistettiin 14 asiaa, 7 löydöstä, 3 ei voitu tarkistaa". The frame sets `finding`
 * and `clear` from the findings that survive, so an area may report either.
 */
export interface Check {
  /** `<area>:<kind>`, the same kind as its findings. */
  id: string;
  /** Finnish, a noun phrase: "Asuntolainan marginaali". */
  label: string;
  status: CheckStatus;
  /** The input key that would let the check run (status `needs_input`). */
  input?: string;
  /** One Finnish sentence: what is missing ("Lisää lainatilin saldo kohdassa Asetukset > Tilit."). */
  hint?: string;
}

/** A block of figures an area shows beside its findings (bank fees by price list line, car costs). No saving claimed. */
export interface AreaSummary {
  title: string;
  lines: readonly CalcLine[];
}

export interface AreaResult {
  findings: readonly FindingDraft[];
  checks: readonly Check[];
  summary?: AreaSummary;
}

/** The kinds of typed input (`inputs.ts`). */
export type HousingType = "kerrostalo" | "rivitalo" | "omakotitalo" | "vuokra" | "asumisoikeus";
export type LoanReference = "euribor_12" | "euribor_6" | "euribor_3" | "fixed";

export interface LoanRateValue {
  /** The margin in hundredths of a percentage point: 0 to 500 (0–5,00 %). */
  marginBp: number;
  reference: LoanReference;
}

/** The value of each input, by its key without a subject. Money in cents, rates in hundredths of a percent. */
export interface InputValueMap {
  loan_rate: LoanRateValue;
  electricity_kwh: number;
  electricity_contract_end: IsoDate;
  housing_type: HousingType;
  moved_on: IsoDate;
  /** Cents a year. */
  insurance_quote: number;
  /** Cents a year. */
  parking_permit_price: number;
  car_km: number;
}
export type InputKey = keyof InputValueMap;
export type InputValue = InputValueMap[InputKey];

/** An input as stored (`optimise_inputs`): the parsed value and the day it was saved. */
export interface StoredInput {
  value: InputValue;
  asOf: IsoDate;
}

/** The user's typed inputs by full key (`loan_rate`, `insurance_quote:<series id>`). */
export type InputValues = Readonly<Record<string, StoredInput>>;

/**
 * What the evidence accounts look like over the window: `dataQualityReport` for the whole household and per account,
 * so a gap on the card account does not lower a finding about the checking account.
 */
export interface EvidenceQuality {
  /** The household's signals over the window. */
  signals: readonly QualitySignal[];
  /** Account id to the `gap`, `stale` and `own_unconnected` signals of that account alone. */
  byAccount: Readonly<Record<string, readonly QualitySignal["id"][]>>;
}

/** What every area gets. */
export interface AreaInput {
  ctx: AnalysisContext;
  /** ctx.today, the only clock. */
  today: IsoDate;
  /** The last day of the last complete month. */
  end: IsoDate;
  /** The complete months up to `end`, oldest first, at most 12 (rule 2). */
  months: readonly string[];
  balances: readonly BalanceInput[];
  /** Marks and expected bills, read per request. */
  inputs: UserInputs;
  /** The typed inputs; read them with `valueOf`, which treats a stale one as missing. */
  values: InputValues;
  /** Merchant name to TOL code, from the user's own register lookups. */
  industry: ReadonlyMap<string, string>;
  quality: EvidenceQuality;
}

export interface Area {
  id: AreaId;
  /** Finnish, 1 to 3 words. */
  label: string;
  assess: (input: AreaInput) => AreaResult;
}

export type FindingStatus = "done" | "dismissed" | "snoozed";
/** Ei koske meitä: tarvitsen tämän, olen jo kilpailuttanut, arvio on väärä, en voi vaikuttaa. */
export const DISMISS_REASONS = ["need_it", "compared", "wrong", "cannot"] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number];

/** Monthly sums of a finding's measure before the change (`baselineOf`), oldest first. */
export type Baseline = readonly { month: string; cents: number }[];

/** The user's decision on a finding (`optimise_states`). */
export interface FindingState {
  findingId: string;
  status: FindingStatus;
  /** Dismissed only. */
  reason: DismissReason | null;
  /** Snoozed only: the finding is hidden before this day. */
  until: IsoDate | null;
  /** Done only: the day the change took effect. */
  effectiveDate: IsoDate | null;
  /** The finding's mid when the user decided; the re-alarm and the follow-up compare against it. */
  midCents: number | null;
  /** Done only. */
  baseline: Baseline | null;
  /** ISO timestamp. */
  decidedAt: string;
}

/** Tilanne: four facts against the household's own months, no score. */
export interface SituationFact {
  id: "savings_rate" | "fixed_share" | "buffer" | "debt_share";
  /** Finnish heading. */
  label: string;
  /** A share (0.12 = 12 %) or months; null when the data cannot tell. */
  value: number | null;
  unit: "share" | "months";
  /** The value as the page shows it: "12 %", "2,7 kuukautta"; "" when null. */
  text: string;
  /** One Finnish sentence with the sums it stands on; when null, why. */
  basis: string;
  /** The line it is drawn against (3 months of buffer, 35 % of debt service), in the same unit. */
  reference?: number;
}

export interface Headline {
  lowCents: number;
  midCents: number;
  highCents: number;
  /** Findings summed. */
  count: number;
}

export interface AreaView {
  id: AreaId;
  label: string;
  /** Active findings, at most three, korkea and keskitaso before matala. */
  findings: Finding[];
  /** Active findings left out by the cap of three. */
  more: number;
  checks: Check[];
  summary?: AreaSummary;
  /** The order key: mid times the certainty weight, summed. */
  weightCents: number;
}

/** An input the page asks for, with what it unlocks and the old value when it went stale. */
export interface NeededInput {
  /** Full key, as stored. */
  key: string;
  def: InputKey;
  subject: string | null;
  areas: AreaId[];
  /** The stale value and its day, or null when there is none. */
  old: StoredInput | null;
}

export interface OptimiseData {
  today: IsoDate;
  end: IsoDate;
  /** Complete months in the window (0 to 12): under 3 only deadlines, under 6 no euros. */
  months: number;
  /** Complete months in the whole history, for the header. */
  historyMonths: number;
  /** The latest booking date, for the header; null without rows. */
  dataTo: IsoDate | null;
  accounts: number;
  situation: SituationFact[];
  headline: Headline;
  /** Ordered by `weightCents`, largest first. */
  areas: AreaView[];
  /** Active korkea and keskitaso findings with `decideBy` within 60 days, soonest first. */
  soon: Finding[];
  /** Jo hoidossa. `finding` is null when the condition no longer shows in the data. */
  done: { state: FindingState; finding: Finding | null }[];
  /** Ei koske meitä: dismissed findings that still show in the data. */
  dismissed: { state: FindingState; finding: Finding }[];
  needed: NeededInput[];
  checked: { total: number; findings: number; unavailable: number };
}

/** An input as the server stores and returns it: its full key and what the core keeps of it. */
export interface InputRow extends StoredInput {
  key: string;
}

/** `GET /api/optimise` (server services/optimise.ts): the page, the viewer's own inputs and decisions, the changes since last month and the follow-up. */
export interface OptimiseResponse {
  data: OptimiseData;
  inputs: InputRow[];
  states: FindingState[];
  changes: FindingChange[];
  followUp: FollowUp;
}

export interface EvidenceRow {
  id: string;
  date: IsoDate;
  merchant: string;
  amountCents: number;
  accountId: string;
  account: string;
  struck: boolean;
}

/** `GET /api/optimise/evidence`: the finding recomputed, with the rows it stands on and the monthly sums of what it measures. */
export interface EvidenceResponse {
  id: string;
  calc: readonly CalcLine[];
  rows: EvidenceRow[];
  sums: Baseline;
}
