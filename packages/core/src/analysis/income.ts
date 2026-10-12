/**
 * Income by type. The category says salary, benefits, interest and so on; the type splits it further from the payer,
 * the message and the payment pattern (Kela by benefit, holiday pay, a bonus). It is derived on every read and never
 * stored, so a rule change needs no migration, and a category the user set wins: the type only splits it.
 *
 * Earned income is everything but money from people and refunds, which are shown and left out of growth and stability.
 * A type the rows cannot tell apart stays at its broader type ("Kela, muu", "Muut etuudet").
 */
import { getCategory } from "../categories.ts";
import { addDays, monthOf } from "../dates.ts";
import { fold } from "../merchant.ts";
import { median } from "../stats.ts";
import type { IsoDate } from "../types.ts";
import type { AnalysisTx } from "./context.ts";
import { isPensionPayerName } from "../wording.ts";
import { oneOffs, PAY } from "./one-offs.ts";

export type IncomeType =
  | "salary"
  | "holiday_pay"
  | "other_pay"
  | "kela_housing"
  | "kela_child"
  | "kela_study"
  | "kela_general"
  | "kela_parental"
  | "kela_sickness"
  | "kela_homecare"
  | "kela_pension"
  | "kela_other"
  | "unemployment_fund"
  | "earnings_pension"
  | "benefit_other"
  | "tax_refund"
  | "investment"
  | "sales"
  | "other_income"
  | "persons"
  | "refunds";

/** The chart layers, in their fixed colour order. */
export type IncomeGroup = "salary" | "extra_pay" | "kela" | "fund" | "pension" | "other" | "not_earned";

export interface IncomeTypeDef {
  label: string;
  group: IncomeGroup;
  /** Comes on a schedule: salary, benefits, pensions. Stability and the forecast read these only. */
  regular: boolean;
  /** False for money from people and refunds: shown, never counted as earned income. */
  earned: boolean;
}

export const INCOME_TYPES: Record<IncomeType, IncomeTypeDef> = {
  salary: { label: "Palkka", group: "salary", regular: true, earned: true },
  holiday_pay: { label: "Lomaraha", group: "extra_pay", regular: false, earned: true },
  other_pay: { label: "Muu palkka", group: "extra_pay", regular: false, earned: true },
  kela_housing: { label: "Kela: asumistuki", group: "kela", regular: true, earned: true },
  kela_child: { label: "Kela: lapsilisä", group: "kela", regular: true, earned: true },
  kela_study: { label: "Kela: opintotuki", group: "kela", regular: true, earned: true },
  // yleistuki replaced työmarkkinatuki and peruspäiväraha on 1.5.2026: one type, so the switch is not an end and a start
  kela_general: { label: "Kela: yleistuki tai työttömyystuki", group: "kela", regular: true, earned: true },
  kela_parental: { label: "Kela: vanhempainraha", group: "kela", regular: true, earned: true },
  kela_sickness: { label: "Kela: sairauspäiväraha", group: "kela", regular: true, earned: true },
  kela_homecare: { label: "Kela: kotihoidon tuki", group: "kela", regular: true, earned: true },
  kela_pension: { label: "Kela: kansaneläke", group: "kela", regular: true, earned: true },
  kela_other: { label: "Kela, muu", group: "kela", regular: true, earned: true },
  unemployment_fund: { label: "Ansiosidonnainen päiväraha", group: "fund", regular: true, earned: true },
  earnings_pension: { label: "Työeläke", group: "pension", regular: true, earned: true },
  benefit_other: { label: "Muut etuudet", group: "other", regular: false, earned: true },
  tax_refund: { label: "Veronpalautus", group: "other", regular: false, earned: true },
  investment: { label: "Osingot ja korot", group: "other", regular: false, earned: true },
  sales: { label: "Myyntitulot", group: "other", regular: false, earned: true },
  other_income: { label: "Muut tulot", group: "other", regular: false, earned: true },
  persons: { label: "Maksut henkilöiltä", group: "not_earned", regular: false, earned: false },
  refunds: { label: "Hyvitykset", group: "not_earned", regular: false, earned: false },
};

export const INCOME_TYPE_ORDER = Object.keys(INCOME_TYPES) as IncomeType[];

export const INCOME_GROUPS: readonly { id: IncomeGroup; label: string }[] = [
  { id: "salary", label: "Palkka" },
  { id: "extra_pay", label: "Lomaraha ja muu palkka" },
  { id: "kela", label: "Kela" },
  { id: "fund", label: "Ansiosidonnainen" },
  { id: "pension", label: "Työeläke" },
  { id: "other", label: "Muut tulot" },
  { id: "not_earned", label: "Maksut henkilöiltä ja hyvitykset" },
];

/** Whole-word alternation on folded text, as in categorize.ts. */
const w = (alternatives: string) => new RegExp(String.raw`(?<![A-Z0-9])(?:${alternatives})(?![A-Z0-9])`);

const HOLIDAY_WORDS = w(String.raw`LOMARAHA[A-Z]*|LOMAPALKKA|SEMESTERPENNING|SEMESTERLON|HOLIDAY PAY`);
/** LOMAKORVAUS is paid when a job ends; PALKKIO and bonuses come off schedule. */
const OTHER_PAY_WORDS = w(String.raw`LOMAKORVAUS|SEMESTERERSATTNING|PALKKIO|KOKOUSPALKKIO|TULOSPALKKIO|TULOSPALKKA|KANNUSTINPALKKIO|TYOKORVAUS|BONUS|PROVISIO`);
export const JOB_END_WORDS = w(String.raw`LOMAKORVAUS|SEMESTERERSATTNING`);
/** A tax refund comes from the tax office: a person passing one on is not a refund. Tested on the payer only. */
const TAX_PAYER = w(String.raw`VEROHALLINTO|SKATTEFORVALTNINGEN`);
const KELA_WORDS = w(String.raw`KELA|FPA|KANSANELAKELAITOS|FOLKPENSIONSANSTALTEN`);
/** Benefit words with Kela as the payer even when the row leaves the payer out. */
const KELA_BENEFITS: readonly [IncomeType, RegExp][] = [
  // before the pension words: "eläkkeensaajan asumistuki" is housing allowance
  ["kela_housing", w(String.raw`[A-Z]*ASUMISTUKI|ASUMISLISA|BOSTADSBIDRAG`)],
  ["kela_child", w(String.raw`LAPSILISA[A-Z]*|BARNBIDRAG`)],
  ["kela_study", w(String.raw`OPINTOTUKI|OPINTORAHA|STUDIEPENNING|STUDIESTOD`)],
  ["kela_general", w(String.raw`YLEISTUKI|TYOMARKKINATUKI|PERUSPAIVARAHA|ARBETSMARKNADSSTOD|GRUNDDAGPENNING|ALLMANT STOD`)],
  ["kela_parental", w(String.raw`VANHEMPAIN(?:PAIVA)?RAHA|AITIYSRAHA|ISYYSRAHA|ERITYISAITIYSRAHA|[A-Z]*RASKAUSRAHA|FORALDRA(?:DAG)?PENNING`)],
  ["kela_sickness", w(String.raw`[A-Z]*SAIRAUSPAIVARAHA|SJUKDAGPENNING`)],
  ["kela_homecare", w(String.raw`KOTIHOIDON ?TUKI|JOUSTAVA HOITORAHA|OSITTAINEN HOITORAHA|HEMVARDSSTOD`)],
  ["kela_pension", w(String.raw`KANSANELAKE|TAKUUELAKE|ELAKETUKI|FOLKPENSION|GARANTIPENSION`)],
];
const FUND_WORDS = w(String.raw`[A-Z]*TYOTTOMYYSKASSA[A-Z]*|ERILLISKASSA|YTK|ERTO|JATTK|ARBETSLOSHETSKASSA[A-Z]*|ANSIOPAIVARAHA|ANSIOSIDONNAINEN`);
const PENSION_WORDS = w(String.raw`[A-Z]*ELAKE[A-Z]*|PENSION`);

export type IncomeRow = Pick<AnalysisTx, "category" | "merchant" | "counterparty" | "description" | "amountCents">;

const textOf = (t: IncomeRow) => fold(`${t.merchant} ${t.counterparty ?? ""} ${t.description ?? ""}`);

/** The payer as the row names it: merchant and counterparty, folded and trimmed. */
const payerNames = (t: IncomeRow) => [fold(t.merchant).trim(), fold(t.counterparty ?? "").trim()] as const;

function isPensionPayer(t: IncomeRow): boolean {
  const [merchant, counterparty] = payerNames(t);
  // a bare "Elo" only as the counterparty: as a merchant name it may be cut from a longer text
  return counterparty === "ELO" || isPensionPayerName(merchant) || isPensionPayerName(counterparty);
}

function benefitType(text: string, t: IncomeRow): IncomeType {
  if (TAX_PAYER.test(payerNames(t).join(" "))) return "tax_refund";
  const named = KELA_BENEFITS.find(([, re]) => re.test(text));
  if (named) return named[0];
  if (KELA_WORDS.test(text)) return /ELAKE/.test(text.replace(/KANSANELAKELAITOS/g, "")) ? "kela_pension" : "kela_other";
  if (FUND_WORDS.test(text)) return "unemployment_fund";
  if (PENSION_WORDS.test(text) || isPensionPayer(t)) return "earnings_pension";
  return "benefit_other";
}

/**
 * The type one row says by itself, from its category and words. Salary rows get their final type from the pattern of
 * their payer (`incomeTypes`): an extra payment in a month, or one far above the usual, is holiday pay or other pay.
 * Money in on a spending category that was no refund (`moneyIn`) is income too: from a person on Maksut henkilöille,
 * a compensation or refund on any other.
 */
export function incomeTypeOf(t: IncomeRow): IncomeType {
  const text = textOf(t);
  switch (t.category) {
    case "salary":
      return HOLIDAY_WORDS.test(text) ? "holiday_pay" : OTHER_PAY_WORDS.test(text) ? "other_pay" : "salary";
    case "benefits":
      return benefitType(text, t);
    case "investment_income":
      return "investment";
    case "sales":
      return "sales";
    case "p2p_in":
    case "p2p":
      return "persons";
    case "reimbursements":
      return "refunds";
    default:
      return getCategory(t.category).kind === "income" ? "other_income" : "refunds";
  }
}

/** Rows that count as income in the money flows: the same rows the cash flow report sums. */
export const isIncomeRow = (t: Pick<AnalysisTx, "flows">) => t.flows.income !== 0;

/** The categories of money from people and refunds (types `persons` and `refunds`): income in the flows, never earned. */
const NOT_EARNED: ReadonlySet<string> = new Set(["p2p_in", "reimbursements"]);

/**
 * Earned income: an income row that is not money from people or a refund, whether its category says so or it is money
 * in on a spending category (`moneyIn`). The one predicate behind every "tavalliset tulot" (`usualIncome` in usual.ts)
 * and the same split as the `earned` flag of `INCOME_TYPES`.
 */
export const isEarnedIncome = (t: Pick<AnalysisTx, "flows" | "category">) => isIncomeRow(t) && getCategory(t.category).kind === "income" && !NOT_EARNED.has(t.category);

/** The payer a series is grouped by: the cleaned merchant name, folded. */
export const payerKey = (t: Pick<AnalysisTx, "merchant">) => fold(t.merchant);

/** A row with a holiday word this close to the usual pay is the regular pay with its text. */
const NEAR_USUAL = 0.15;

/**
 * The pay period of a payment. A payer that pays near a month boundary (the last banking day, the 1st moved to the
 * Friday before) is shifted by ten days, so a payment on 30.9. and one on 1.11. belong to October and November.
 */
export function periodOf(dates: readonly IsoDate[]): (d: IsoDate) => string {
  const boundary = dates.filter((d) => {
    const day = Number(d.slice(8, 10));
    return day >= 25 || day <= 5;
  }).length;
  return boundary * 2 > dates.length ? (d) => monthOf(addDays(d, 10)) : monthOf;
}

/** Final type of every income row, keyed by row id. Salary rows are typed by the pattern of their payer. */
export function incomeTypes(txs: readonly AnalysisTx[]): Map<string, IncomeType> {
  const out = new Map<string, IncomeType>();
  const income = txs.filter(isIncomeRow);
  for (const t of income) out.set(t.id, incomeTypeOf(t));
  for (const rows of payersOf(income).values()) refinePay(rows, out);
  return out;
}

/** The salary payments of each payer, keyed by `payerKey`. */
export function payersOf(txs: readonly AnalysisTx[]): Map<string, AnalysisTx[]> {
  const payers = new Map<string, AnalysisTx[]>();
  for (const t of txs) {
    if (t.category !== "salary" || t.amountCents <= 0) continue;
    const key = payerKey(t);
    const list = payers.get(key);
    if (list) list.push(t);
    else payers.set(key, [t]);
  }
  return payers;
}

/** One payer's payments by pay period (the month, see `periodOf`), judged over all of the payer's payments. */
export function byPayPeriod(rows: readonly AnalysisTx[]): Map<string, AnalysisTx[]> {
  const period = periodOf(rows.map((t) => t.bookingDate));
  const byPeriod = new Map<string, AnalysisTx[]>();
  for (const t of rows) {
    const p = period(t.bookingDate);
    const list = byPeriod.get(p);
    if (list) list.push(t);
    else byPeriod.set(p, [t]);
  }
  return byPeriod;
}

function refinePay(rows: readonly AnalysisTx[], out: Map<string, IncomeType>): void {
  const plain = rows.filter((t) => out.get(t.id) === "salary");
  if (plain.length < 3) return;
  const usual = median(plain.map((t) => t.amountCents));
  const byPeriod = byPayPeriod(rows);
  const counts = [...byPeriod.values()].map((l) => l.length);
  // a payer that pays twice a month or every two weeks: a second payment in a month is no extra
  const multi = median(counts) >= 2;
  const extraType = (t: AnalysisTx): IncomeType => {
    const month = Number(t.bookingDate.slice(5, 7));
    return month >= 5 && month <= 8 ? "holiday_pay" : "other_pay";
  };
  const mains: AnalysisTx[] = [];
  for (const list of byPeriod.values()) {
    if (list.length === 1) {
      const t = list[0]!;
      const type = out.get(t.id)!;
      // "PALKKA JA LOMAPALKKA" as the only payment of the month, near the usual: the regular pay
      if (type !== "salary" && Math.abs(t.amountCents - usual) <= usual * NEAR_USUAL) out.set(t.id, "salary");
      if (out.get(t.id) === "salary") mains.push(t);
      continue;
    }
    if (multi) {
      for (const t of list) if (out.get(t.id) === "salary") mains.push(t);
      continue;
    }
    const regular = list.filter((t) => out.get(t.id) === "salary");
    const main = (regular.length ? regular : list).reduce((a, b) => (Math.abs(b.amountCents - usual) < Math.abs(a.amountCents - usual) ? b : a));
    for (const t of list) if (t !== main && out.get(t.id) === "salary") out.set(t.id, extraType(t));
    if (out.get(main.id) === "salary") mains.push(main);
  }
  if (multi) return;
  const extra = oneOffs(mains, PAY);
  for (const t of mains) if (extra.has(t.id)) out.set(t.id, extraType(t));
}

// banking days and pay days moved to pay-day.ts: what was importable from here still is
export { addBankingDays, isBankingDay, nextPayDate, type PayDay, payDate, payDayOf, type PayRule, toBankingDay } from "../pay-day.ts";
