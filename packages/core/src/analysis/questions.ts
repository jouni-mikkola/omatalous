import { dayNumber } from "../dates.ts";
import { type LoanProposal, loanProposals } from "../loan-detect.ts";
import { isUnknownMerchant } from "../merchant.ts";
import type { IsoDate, UserInputs } from "../types.ts";
import { type AnalysisContext, type AnalysisTx, netSpend, spendRows } from "./context.ts";
import { isCardBill } from "./data-quality.ts";
import { incomeTypeOf } from "./income.ts";
import type { DateRange } from "./period.ts";

/** The mark subject of a payee the household set aside: `question:payee:<merchant>`, mark `dismissed`. */
export const QUESTION_PAYEE = "question:payee:";

const WINDOW_DAYS = 365;
const MAX_ITEMS = 5;

/** A payee whose money nothing classified: the household picks it a category, or sets it aside. */
interface PayeeQuestion {
  kind: "payee_out" | "payee_in";
  merchant: string;
  /** The window's sum for the payee, positive. */
  cents: number;
  count: number;
  lastDate: IsoDate;
}

/** A monthly payment that looks like a loan: saved as one in Asetukset > Lainat, or marked "Ei laina". */
interface LoanQuestion {
  kind: "loan";
  key: string;
  payee: string;
  paymentCents: number;
  /** Twelve payments. */
  cents: number;
}

type FrontQuestion = PayeeQuestion | LoanQuestion;

export interface Questions {
  /** The part of the window's money (spending plus income) that is classified, 0 to 1; null when there was none. */
  share: number | null;
  /** Spending of the 365 days up to the period's end: the sum the reports call menot. */
  outCents: number;
  /** Income of the same days. */
  inCents: number;
  /** Spending nobody categorised: category Muut menot by the default. */
  outUnknownCents: number;
  /** Income nobody recognised: type Muut tulot by the default. */
  inUnknownCents: number;
  /** Card bills counted as spending: purchases the app cannot see. */
  cardBillCents: number;
  /** The five largest questions. */
  items: FrontQuestion[];
  /** How many questions there are in all. */
  total: number;
}

interface Group {
  cents: number;
  count: number;
  lastDate: IsoDate;
}

function add(groups: Map<string, Group>, t: AnalysisTx, cents: number): void {
  if (cents === 0 || isUnknownMerchant(t.merchant)) return;
  const g = groups.get(t.merchant) ?? { cents: 0, count: 0, lastDate: t.bookingDate };
  g.cents += cents;
  g.count += 1;
  if (t.bookingDate > g.lastDate) g.lastDate = t.bookingDate;
  groups.set(t.merchant, g);
}

const nameOf = (q: FrontQuestion) => (q.kind === "loan" ? q.payee : q.merchant);
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * How much of the money of the last 365 days up to the period's end is classified, and what would mend the picture
 * most. Money that is not classified is spending the default put in Muut menot (as the alert `uncategorised` and the
 * data quality signal mean it, by what the purchase cost in the end), income the default put in Muut tulot, and card
 * bills. Transfers are no money in or out; a refund lowers the spending it took back, as the reports net it. A payee
 * the household set aside keeps its money in the sums and has no question.
 */
export function buildQuestions(ctx: AnalysisContext, range: DateRange, inputs: UserInputs, proposals: readonly LoanProposal[] = loanProposals(ctx, inputs)): Questions {
  const toDay = dayNumber(range.to);
  const rows = spendRows(ctx, { fromDay: toDay - WINDOW_DAYS + 1, toDay }).filter((t) => t.status === "booked" && !t.isTransfer);
  const dismissed = new Set(inputs.marks.filter((m) => m.mark === "dismissed" && m.subject.startsWith(QUESTION_PAYEE)).map((m) => m.subject.slice(QUESTION_PAYEE.length)));

  let outCents = 0;
  let inCents = 0;
  let outUnknownCents = 0;
  let inUnknownCents = 0;
  let cardBillCents = 0;
  const out = new Map<string, Group>();
  const inn = new Map<string, Group>();
  for (const t of rows) {
    outCents += t.spend;
    inCents += t.flows.income;
    if (isCardBill(t)) cardBillCents += t.spend;
    if (t.category === "other" && t.categorySource === "default" && t.spend > 0) {
      const cents = netSpend(t);
      outUnknownCents += cents;
      add(out, t, cents);
    }
    if (t.flows.income !== 0 && t.categorySource === "default" && incomeTypeOf(t) === "other_income") {
      inUnknownCents += t.flows.income;
      add(inn, t, t.flows.income);
    }
  }

  const items: FrontQuestion[] = [];
  for (const [kind, groups] of [["payee_out", out], ["payee_in", inn]] as const) {
    for (const [merchant, g] of groups) if (g.cents > 0 && !dismissed.has(merchant)) items.push({ kind, merchant, cents: g.cents, count: g.count, lastDate: g.lastDate });
  }
  for (const p of proposals) items.push({ kind: "loan", key: p.key, payee: p.payee, paymentCents: p.paymentCents, cents: 12 * p.paymentCents });
  items.sort((a, b) => b.cents - a.cents || compare(a.kind, b.kind) || compare(nameOf(a), nameOf(b)));

  const money = outCents + inCents;
  const share = money === 0 ? null : Math.min(1, Math.max(0, 1 - (outUnknownCents + inUnknownCents + cardBillCents) / money));
  return { share, outCents, inCents, outUnknownCents, inUnknownCents, cardBillCents, items: items.slice(0, MAX_ITEMS), total: items.length };
}
