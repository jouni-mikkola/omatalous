import { dayNumber } from "../dates.ts";
import { type LoanProposal, loanProposals } from "../loan-detect.ts";
import { isUnknownMerchant } from "../merchant.ts";
import { ASK_LIMIT } from "../money-trace.ts";
import { isOffMedian, isPersonName, PAYER_ROLES, payerKeyOf, payerRoleOf, sameName, steadyPayers } from "../payer-role.ts";
import { nameOf, userNameOf } from "../person-names.ts";
import { normalizeIban } from "../transfers.ts";
import type { IsoDate, PayerInput, PayerRole, UserInputs } from "../types.ts";
import { type AnalysisContext, type AnalysisTx, netSpend, spendRows } from "./context.ts";
import { isCardBill } from "./data-quality.ts";
import { incomeTypeOf } from "./income.ts";
import type { DateRange } from "./period.ts";

/** The mark subject of a payee the household set aside: `question:payee:<merchant>`, mark `dismissed`. */
export const QUESTION_PAYEE = "question:payee:";

const WINDOW_DAYS = 365;
const MAX_ITEMS = 5;
/** With payer roles in the inputs a visit asks at most this many questions, of every kind together. */
const MAX_ITEMS_WITH_PAYERS = 3;

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

/**
 * A steady payer, or one whose money reaches `ASK_LIMIT` in the window, that no role answers: what is this money
 * (`PAYER_ROLES`). The answer moves every row of the payer, so the page says it rewrites the past.
 */
interface PayerQuestion {
  kind: "payer";
  /** The payer: `iban:<IBAN>` or `name:<words>` (`payerKeyOf`); an answer for it goes to the store under this key. */
  key: string;
  /** The payer's name as its largest row writes it. */
  merchant: string;
  /** The window's sum of the money the question is about, positive. */
  cents: number;
  count: number;
  lastDate: IsoDate;
  /** The roles to offer, in order. "Sama kaikille tällaisille" (the household's default) is open to all but own money. */
  options: readonly PayerRole[];
  /** About the same sum in three months or more. */
  steady: boolean;
  /** The role to show as the answer: pay or a benefit, a sale, the member's own money at another bank, a steady share. Never a gift. Null: asked with none. */
  proposal: PayerRole | null;
  /** Sums of the window's rows of a steady payer that are off its usual sum: a role of cost share or gift leaves them out. */
  offMedianCents: number[];
}

type FrontQuestion = PayeeQuestion | LoanQuestion | PayerQuestion;

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
  /** The largest questions: five, or three when the inputs carry payer roles. */
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

const askedName = (q: FrontQuestion) => (q.kind === "loan" ? q.payee : q.merchant);
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** What the household is asked about a payer's money: not decided by hand, a rule, pairing or a role, and read as money from people or as unknown income. */
const isOpenIncome = (t: AnalysisTx) =>
  t.amountCents > 0 &&
  t.flows.income !== 0 &&
  t.categorySource !== "user" &&
  t.categorySource !== "match" &&
  t.categorySource !== "transfer" &&
  t.categorySource !== "payer" &&
  (t.category === "p2p_in" || (t.categorySource === "default" && incomeTypeOf(t) === "other_income"));

/**
 * The role to propose for a payer, by its largest row of the window: pay or a benefit, a sale, the member's own money
 * (the row's name is the member's own and its IBAN is no account of the view, so it is no transfer pair), a steady
 * share of the common costs. Never a gift.
 */
function roleProposal(t: AnalysisTx, steady: boolean, own: ReturnType<typeof userNameOf>, ownIbans: ReadonlySet<string | null>): PayerRole | null {
  if (t.category === "salary" || t.category === "benefits") return "pay";
  if (t.category === "sales") return "sales";
  const iban = normalizeIban(t.counterpartyIban);
  if (iban && !ownIbans.has(iban) && own && sameName(own, nameOf(t.counterparty ?? ""))) return "own_money";
  return steady && t.category === "p2p_in" ? "cost_share" : null;
}

/** One question per payer that no role answers and that is steady or reaches `ASK_LIMIT`; `covered`: the merchants whose own question they take over. */
function payerQuestions(ctx: AnalysisContext, rows: readonly AnalysisTx[], payers: PayerInput, dismissed: ReadonlySet<string>): { items: PayerQuestion[]; covered: Set<string> } {
  const money = rows.filter((t) => t.amountCents > 0);
  // the run's median: every row of the member's, not the window's (applyPayerRoles reads the same rows)
  const steady = steadyPayers(ctx.txs);
  const byPayer = new Map<string, AnalysisTx[]>();
  for (const t of money) {
    const key = payerKeyOf(t);
    const list = key ? byPayer.get(key) : undefined;
    if (list) list.push(t);
    else if (key) byPayer.set(key, [t]);
  }
  const ownIbans = new Set(ctx.accounts.map((a) => normalizeIban(a.iban)));
  const own = userNameOf(ctx.accounts);
  const items: PayerQuestion[] = [];
  const covered = new Set<string>();
  for (const [key, all] of byPayer) {
    const open = all.filter(isOpenIncome);
    if (!open.length || open.some((t) => payerRoleOf(payers.roles, t, payers.memberId))) continue;
    const cents = open.reduce((sum, t) => sum + t.flows.income, 0);
    const typical = steady.get(key);
    if (typical === undefined && cents < ASK_LIMIT) continue;
    if (dismissed.has(key) || open.some((t) => dismissed.has(t.merchant))) continue;
    // own money is only for a person: a company or a lender (rows read by a rule of their own) is never the member's
    const isPerson = all.every((t) => (t.category === "p2p_in" || (t.categorySource === "default" && t.category === "income")) && isPersonName(t.counterparty));
    const largest = all.reduce((a, b) => (b.amountCents > a.amountCents ? b : a));
    const lastDate = open.reduce((d, t) => (t.bookingDate > d ? t.bookingDate : d), open[0]!.bookingDate);
    const offMedianCents = typical === undefined ? [] : open.filter((t) => isOffMedian(t.amountCents, typical)).map((t) => t.flows.income);
    items.push({ kind: "payer", key, merchant: largest.merchant, cents, count: open.length, lastDate, options: isPerson ? PAYER_ROLES : PAYER_ROLES.filter((r) => r !== "own_money"), steady: typical !== undefined, proposal: roleProposal(largest, typical !== undefined, own, ownIbans), offMedianCents });
    for (const t of open) covered.add(t.merchant);
  }
  return { items, covered };
}

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
    // a payer that has a role is never asked as a payee: what its role leaves (off the usual sum) is the role's to say
    const answered = inputs.payers !== undefined && t.amountCents > 0 && payerRoleOf(inputs.payers.roles, t, inputs.payers.memberId) !== null;
    if (!answered && t.flows.income !== 0 && t.categorySource === "default" && incomeTypeOf(t) === "other_income") {
      inUnknownCents += t.flows.income;
      add(inn, t, t.flows.income);
    }
  }

  // with payer roles the payer's question comes in place of the payee's: one question about the same money
  const asked = inputs.payers ? payerQuestions(ctx, rows, inputs.payers, dismissed) : { items: [], covered: new Set<string>() };
  const items: FrontQuestion[] = [...asked.items];
  for (const [kind, groups] of [["payee_out", out], ["payee_in", inn]] as const) {
    for (const [merchant, g] of groups) if (g.cents > 0 && !dismissed.has(merchant) && !(kind === "payee_in" && asked.covered.has(merchant))) items.push({ kind, merchant, cents: g.cents, count: g.count, lastDate: g.lastDate });
  }
  for (const p of proposals) items.push({ kind: "loan", key: p.key, payee: p.payee, paymentCents: p.paymentCents, cents: 12 * p.paymentCents });
  items.sort((a, b) => b.cents - a.cents || compare(a.kind, b.kind) || compare(askedName(a), askedName(b)));

  const money = outCents + inCents;
  const share = money === 0 ? null : Math.min(1, Math.max(0, 1 - (outUnknownCents + inUnknownCents + cardBillCents) / money));
  return { share, outCents, inCents, outUnknownCents, inUnknownCents, cardBillCents, items: items.slice(0, inputs.payers ? MAX_ITEMS_WITH_PAYERS : MAX_ITEMS), total: items.length };
}
