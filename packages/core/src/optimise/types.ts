/**
 * Optimoi: the household's decisions, each with a price in euros a year or a deadline, computed from its own history.
 * These types are the contract between the frame (`index.ts`), the thirteen areas (`areas/*.ts`), the server (stored
 * inputs and states) and the page. Money is integer cents, dates are YYYY-MM-DD.
 */
import type { AnalysisContext } from "../analysis/context.ts";
import type { QualitySignal } from "../analysis/data-quality.ts";
import type { Insight } from "../analysis/insights/types.ts";
import type { BalanceInput, IsoDate, LoanReference, UserInputs } from "../types.ts";
import type { FollowUp } from "./outcome.ts";
import type { FindingChange } from "./snapshot.ts";

export const AREA_IDS = ["loans", "savings", "subscriptions", "bank", "electricity", "housing", "insurance", "food", "habits", "seasons", "tax", "kids", "car"] as const;
export type AreaId = (typeof AREA_IDS)[number];

/** Yearly cents, `lowCents <= midCents <= highCents`, positive. */
export interface EuroRange {
  lowCents: number;
  midCents: number;
  highCents: number;
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
  /** A sinä imperative starting with one of the verbs of rule 5 (`ACTION_VERBS` in the invariants test), capitalised. */
  action: string;
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
  /** The day the change the finding is about took effect (a new price), and its name: the evidence chart marks it. */
  change?: { date: IsoDate; label: string };
}

/** A finding as the page gets it. */
export interface Finding extends Omit<FindingDraft, "weaknesses"> {
  certainty: Certainty;
  /** Every weakness the certainty counted (the area's and the frame's, not the household's), in `WEAKNESS_ORDER`. */
  weaknesses: readonly Weakness[];
  /** A dismissed finding that came back because its mid grew over 50 % and over 100 €. */
  reopened?: boolean;
}

/**
 * `no_data` waits for months or a fact; `no_rows` found no row of its kind in the data, so it looked at nothing;
 * `no_subject` has nothing to check (no mortgage, no card): "clear" is for a check that looked at data.
 */
type CheckStatus = "finding" | "clear" | "needs_input" | "no_data" | "no_rows" | "no_subject";

/** Why a check could not say: the months are too few, an outside figure is old or missing, card purchases are missing, or something else. */
type NoDataCause = "history" | "facts" | "cards" | "other";

/** The cause of a `no_data` check and the one sentence that names it. */
export interface NoDataWhy {
  cause: NoDataCause;
  text: string;
}

/**
 * One thing an area looked at: "Tarkistettiin 14 asiaa, 7 löydöstä, 3 ei voitu tarkistaa". The frame sets `finding`
 * and `clear` from the findings that survive, so an area may report either. A check with no row to read reports
 * `no_rows` or `no_subject` and is not counted as checked.
 */
export interface Check {
  /** `<area>:<kind>`, the same kind as its findings. */
  id: string;
  /** Finnish, a noun phrase: "Asuntolainan marginaali". */
  label: string;
  status: CheckStatus;
  /** Why the check could not say (status `no_data`, set by the check or else by the frame). */
  why?: NoDataWhy;
  /** The input key that would let the check run (status `needs_input`). */
  input?: string;
  /** What the check found a month, in cents: the column Kuukaudessa of Tarkistettu. Empty until an area fills it. */
  cents?: number;
  /** How many things the check counted and what they are called ("3", "maksunsaajaa"). Empty until an area fills it. */
  count?: { n: number; noun: string };
  /** One Finnish sentence, set by the Lapset area only; no page shows it. */
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
export type { LoanReference } from "../types.ts";

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
  /** Every active finding, korkea and keskitaso before matala. */
  findings: Finding[];
  checks: Check[];
  summary?: AreaSummary;
  /** The order key: mid times the certainty weight, summed. */
  weightCents: number;
}

/**
 * What an area's tips reach: their euros a year summed as the headline sums them, against the household's spending of
 * the 12 complete months on the rows the tips measure. Säästövinkit's "Missä on eniten säästettävää?" table.
 */
export interface AreaReach {
  area: AreaId;
  /** The area's active findings through `headlineOf`: overlaps, `shared` and matala left out. */
  euros: EuroRange;
  /** How many findings `euros` sums. */
  count: number;
  /** Spending in the window's complete months on any row a finding of the area measures; null when no finding has a measure. */
  spendCents: number | null;
  /** `euros.midCents / spendCents`, 0 to 1 and over; null without spending. */
  share: number | null;
}

/** An input the page asks for, with the old value when it went stale. */
export interface NeededInput {
  /** Full key, as stored. */
  key: string;
  def: InputKey;
  subject: string | null;
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
  /** The household's faults counted on no finding (`uncategorised`, `own_unconnected`), once each: the page prints them above the findings. */
  household: Weakness[];
  /** Ordered by `weightCents`, largest first. */
  areas: AreaView[];
  /** The areas whose tips have euros the headline would count, largest mid first (`reachOf`). */
  reach: AreaReach[];
  /** Active korkea and keskitaso findings with `decideBy` within 60 days, soonest first. */
  soon: Finding[];
  /** Päätetyt, done. `finding` is null when the condition no longer shows in the data. */
  done: { state: FindingState; finding: Finding | null }[];
  /** Päätetyt, Ei koske meitä: dismissed findings that still show in the data. */
  dismissed: { state: FindingState; finding: Finding }[];
  /** Päätetyt, Muistutus: findings snoozed until a day after today. `finding` is null when the data no longer shows it. */
  snoozed: { state: FindingState; finding: Finding | null }[];
  /** The share of the window's spending that is not itemised, 0 to 1 (`unknownSpending`). */
  unknownShare: number;
  /** Muut havainnot: the insights of the findings' window that no finding covers, largest yearly figure first (`others.ts`). */
  others: Insight[];
  /** Päätetyt, Ei koske meitä: insights dismissed at a figure within 25 % of today's. */
  othersDismissed: DismissedInsight[];
  needed: NeededInput[];
  /**
   * `total` is every check, and splits into those that found something or found nothing, `unavailable` (waiting for a
   * number, a fact or months) and `noRows` (no row of their kind to read) and `noSubject` (nothing to check: no mortgage, no card). `findings` counts active findings, not checks.
   */
  checked: { total: number; findings: number; unavailable: number; noRows: number; noSubject: number };
}

/** An insight the household dismissed (Ei koske meitä) that stays hidden until its figure moves 25 %. */
export interface DismissedInsight {
  insight: Insight;
  /** The mark that hides it (`alert:<id>@<yearlyCents>`); Peruuta takes this mark away. */
  subject: string;
  /** ISO timestamp of the mark. */
  markedAt: string;
}

/** An input as the server stores and returns it: its full key and what the core keeps of it. */
export interface InputRow extends StoredInput {
  key: string;
}

/** One move of the reference rate for one loan. */
export interface RateMove {
  shiftBp: number;
  /** The move the rate made: a fall stops at the margin, so it can be less than `shiftBp`. Null without a rate. */
  movedBp: number | null;
  paymentCents: number | null;
  /** `paymentCents` less today's payment; null when either is unknown. */
  paymentChangeCents: number | null;
  /** The interest of the 12 months after today at the moved rate. */
  interestCents: number | null;
  interestChangeCents: number | null;
}

/** A loan and what each move of its reference rate does to it (`loanRatesOf`). */
export interface LoanRates {
  loanId: string;
  name: string;
  /** The bank, for its logo; null when the loan names none. */
  lender: string | null;
  balanceCents: number | null;
  rateBp: number | null;
  /** The reference rate's Finnish name ("12 kuukauden Euribor", "Kiinteä korko"); null when the loan names none. */
  reference: string | null;
  paymentCents: number | null;
  /** Months between payments. */
  intervalMonths: number | null;
  interestCents: number | null;
  /** Empty for a loan a reference rate does not move (fixed, none named) and for one without a rate. */
  moves: RateMove[];
}

/** `GET /api/optimise` (server services/optimise.ts): the page, the viewer's own inputs and decisions, the changes since last month and the follow-up. */
export interface OptimiseResponse {
  data: OptimiseData;
  inputs: InputRow[];
  states: FindingState[];
  changes: FindingChange[];
  followUp: FollowUp;
  /** Each loan of the household and what a move of its reference rate does (`loanRatesOf`). */
  rates: LoanRates[];
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
  /** The finding's `change`, marked on the monthly sums; null when it has none. */
  change: { date: IsoDate; label: string } | null;
}
