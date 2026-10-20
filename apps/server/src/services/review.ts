/**
 * Tarkistettavat: every question the app cannot settle itself, in one queue ordered by the money at stake. Each source
 * keeps its own answer route (rules, payer roles, marks, loans, account answers); this only gathers and orders, so an
 * answer given here changes what the old card's answer changed.
 */
import { addDays, type AnalysisTx, billCents, buildHousing, buildQuestions, countingMark, fromDayNumber, getCategory, type GuessCandidate, householdWords, type InputKey, type LoanKind, lenderInstalments, marksBySubject, payeeGuesser, seriesMarkSubject, type StoredInput } from "@banking/core";
import { proposalsFor, requestInputs, usesWithTraces } from "./analysis.ts";
import type { Services } from "./context.ts";
import { industryMap } from "./enrich.ts";
import { neededInputs } from "./optimise.ts";
import { settledTrace } from "./money-trace.ts";

type Asked = ReturnType<typeof buildQuestions>["items"][number];
type PayeeAsked = Extract<Asked, { kind: "payee_out" | "payee_in" }>;
type PayerAsked = Extract<Asked, { kind: "payer" }>;

/**
 * What every item carries: an id unique in the queue, the money at stake over a year (positive, the queue's order), and
 * the item's own rows, newest first: exactly the rows its figure counts, so the page filters and adds nothing.
 */
interface Base {
  id: string;
  cents: number;
  rows?: ItemRow[];
  /** How many rows the item counts; `rows` holds the newest `ROWS` of them. */
  rowCount?: number;
}

/** A row as the card shows it: the payee's display name, and the bank's own text to read beside it. */
interface ItemRow {
  id: string;
  date: string;
  cents: number;
  name: string;
  text: string;
}

/** The rows an item sends at most: the card shows three and opens the rest. */
const ROWS = 24;

/**
 * A payee of Muut menot or Muut tulot: a category for it (POST /api/rules) or "Älä kysy enää" (mark `question:payee:`).
 * `picks` are the categories offered first: the guess when there is one (`payeeGuesser`, core payee-guess.ts), then the
 * categories the household uses most on that side, which are no guess about the payee.
 */
type PayeeItem = Base & Omit<PayeeAsked, "cents" | "rowIds"> & { picks: string[]; guess?: Pick<GuessCandidate, "category" | "reason"> };

/** Money from a payer no role answers: PUT /api/payer-roles. `proposal` is the app's guess. */
type PayerItem = Base & Omit<PayerAsked, "cents" | "offMedianCents" | "rowIds">;

/**
 * A monthly payment to a lender nobody saved as a loan. Placed: the app knows what it is and asks to save it
 * (POST /api/loans). Not placed: "Mikä laina tämä on?" (mark `question:loan-kind:`). "Ei laina" either way.
 */
interface LoanItem extends Base {
  kind: "loan";
  key: string;
  payee: string;
  paymentCents: number;
  months: number;
  firstDate: string;
  lastDate: string;
  /** The app's guess of the kind, for the form; the household decides. */
  guess: LoanKind;
  placed: boolean;
}

/**
 * Money on a shared account nobody said whose it was (PUT /api/accounts/:id/answers). There is no guess: a split exists
 * only when a member said it, so the page offers the users, "Yhteistä" and "En tiedä" alike.
 */
interface SplitItem extends Base {
  kind: "split";
  accountId: string;
  accountName: string;
  question: "in" | "opening";
  key: string;
  /** The payer's name, or the opening's day. */
  label: string;
}

/**
 * An instalment plan of a payment service whose end nobody has said: "Montako maksua on vielä jäljellä?", answered with
 * the payments left (counted from `lastDate`), the last month or "En tiedä" (mark `question:plan-end:` or `question:plan-unknown:`).
 */
interface PlanItem extends Base {
  kind: "plan";
  key: string;
  payee: string;
  paymentCents: number;
  lastDate: string;
}

/** A small subscription that has run for half a year with no mark: Käytössä or Lopetettu (mark on `subject`). */
interface SubscriptionItem extends Base {
  kind: "subscription";
  seriesId: string;
  subject: string;
  merchant: string;
  monthlyCents: number;
  lastDate: string;
}

/**
 * A number Säästövinkit waits for (PUT /api/optimise/inputs/:key, which never reprocesses): `def` names the field,
 * `subject` the series of a per-subscription input, `old` the stale value when one went out of date.
 */
interface InputItem extends Base {
  kind: "input";
  key: string;
  def: InputKey;
  subject: string | null;
  old: StoredInput | null;
}

/**
 * Whether the household has a home loan, asked while Asuminen shows none and nothing says they rent (core `buildHousing`'s
 * `ask`). Answered by adding the loan in Asetukset > Lainat or with the mark `question:mortgage` (PUT /api/marks), the
 * subject the first page's card stored before the question moved here, so an old answer still counts.
 */
interface MortgageItem extends Base {
  kind: "mortgage";
}

/**
 * The slot of an extension's source: `type` is the extension's own name for the kind of question. Each choice names
 * its own answer route under /api, which the page calls as it is.
 */
interface ExtensionItem extends Base {
  kind: "extension";
  type: string;
  title: string;
  question: string;
  detail?: string;
  date?: string;
  guess?: string;
  choices: { id: string; label: string; answer: { method: "PUT" | "POST"; path: `/api/${string}`; body: unknown } }[];
}

export type ReviewItem = PayeeItem | PayerItem | LoanItem | PlanItem | SplitItem | SubscriptionItem | InputItem | MortgageItem | ExtensionItem;

export interface Review {
  items: ReviewItem[];
}

/** An item as a source gives it: the ids of its rows, which the queue turns into rows. */
/** `whole`: the rows are shown as the bank charged them, the basis of the item's figure (a loan's payment), also where the view counts them at a part. */
type Sourced = ReviewItem & { rowIds?: readonly string[]; whole?: true };

/** One source of questions. An extension adds its own to `SOURCES`. */
type Source = (s: Services, userId: string) => Promise<Sourced[]>;

/** The questions of the front page's old card (payees, payers), all of them. */
const front: Source = async (s, userId) => {
  const { ctx, accounts } = await s.analysis.get(s, userId, "own");
  const { inputs } = await requestInputs(s, userId, accounts);
  const today = s.today();
  const picks = usedMost(ctx.txs, addDays(today, -365));
  const repo = s.finance(userId);
  const [rules, industries, user] = await Promise.all([repo.listRules(), industryMap(repo), s.users.get(userId)]);
  const rank = payeeGuesser({ rows: ctx.txs, rules, industries, household: householdWords([user?.displayName, ...accounts.map((a) => a.holder)]) });
  // no proposals: the loans and plans come from their own source with the placed loans too, so nothing is asked twice
  return buildQuestions(ctx, { from: today, to: today }, inputs, [], Infinity).items.flatMap((q): Sourced[] => {
    if (q.kind === "payer") {
      const { offMedianCents: _off, ...rest } = q;
      return [{ ...rest, id: `payer:${q.key}` }];
    }
    if (q.kind === "loan" || q.kind === "plan") return [];
    const used = q.kind === "payee_in" ? picks.in : picks.out;
    const guess = rank(q.merchant, q.kind === "payee_in" ? "in" : "out").guess;
    if (!guess) return [{ ...q, id: `${q.kind}:${q.merchant}`, picks: used }];
    return [{ ...q, id: `${q.kind}:${q.merchant}`, picks: [guess.category, ...used.filter((c) => c !== guess.category)].slice(0, PICKS), guess: { category: guess.category, reason: guess.reason } }];
  });
};

/** How many quick picks a payee's question offers before "Muu luokka…". */
const PICKS = 4;

/**
 * The categories of the household's own booked rows since `from`, the most rows first: spending categories for money
 * out (not Muut menot), income categories for money in (not Muut tulot). Transfers and rows nothing categorised count for none.
 */
function usedMost(txs: readonly Pick<AnalysisTx, "bookingDate" | "status" | "isTransfer" | "category" | "categorySource" | "amountCents">[], from: string): { out: string[]; in: string[] } {
  const counts = { out: new Map<string, number>(), in: new Map<string, number>() };
  for (const t of txs) {
    if (t.bookingDate < from || t.status !== "booked" || t.isTransfer || t.categorySource === "default") continue;
    const kind = getCategory(t.category)?.kind;
    const side = t.amountCents < 0 && kind === "expense" && t.category !== "other" ? counts.out : t.amountCents > 0 && kind === "income" && t.category !== "income" ? counts.in : null;
    side?.set(t.category, (side.get(t.category) ?? 0) + 1);
  }
  const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, PICKS).map(([id]) => id);
  return { out: top(counts.out), in: top(counts.in) };
}

// a plan is asked its end once; a loan is asked until it is saved or marked "Ei laina". Its rows are its series' own, at the
// bank's whole charge as the payment is (a joint account counted at a part cuts them in the view)
const loans: Source = async (s, userId) => {
  const { ctx } = await s.analysis.get(s, userId, "own");
  const series = new Map([...ctx.recurring, ...lenderInstalments(ctx)].map((r) => [r.id, r.transactionIds]));
  return (await proposalsFor(s, userId)).flatMap((p): Sourced[] => {
    const cents = 12 * p.paymentCents;
    const rowIds = series.get(p.seriesId) ?? [];
    if (p.plan) return p.planAnswer === null ? [{ kind: "plan", id: `plan:${p.key}`, cents, key: p.key, payee: p.payee, paymentCents: p.paymentCents, lastDate: p.lastDate, rowIds, whole: true }] : [];
    return [{ kind: "loan", id: `loan:${p.key}`, cents, key: p.key, payee: p.payee, paymentCents: p.paymentCents, months: p.months, firstDate: p.firstDate, lastDate: p.lastDate, guess: p.kind, placed: p.placed, rowIds, whole: true }];
  });
};

// the questions of a split go to the member who linked the account, as Asetukset > Tilit shows them
const splits: Source = async (s, userId) => {
  const accounts = await s.finance(userId).listAccounts();
  const { traces } = await usesWithTraces(s, userId, accounts);
  const items: Sourced[] = [];
  for (const a of accounts) {
    const facts = traces.get(a.id);
    const t = facts ? await settledTrace(s, facts.key) : null;
    if (!t) continue;
    for (const q of t.questions) {
      const label = q.kind === "opening" ? fromDayNumber(t.raw.openingDay) : (t.labels.get(q.key) ?? "");
      if (label) items.push({ kind: "split", id: `split:${a.id}:${q.kind}:${q.key}`, cents: q.openCents, accountId: a.id, accountName: a.name, question: q.kind, key: q.key, label });
    }
  }
  return items;
};

const subscriptions: Source = async (s, userId) => {
  const { ctx } = await s.analysis.get(s, userId, "own");
  const marks = marksBySubject(await s.finance(userId).listMarks());
  return ctx.recurring
    .filter((r) => r.review && !countingMark(marks, r, ctx.today))
    .map((r) => ({ kind: "subscription", id: `subscription:${r.id}`, cents: r.yearlyCents, seriesId: r.id, subject: seriesMarkSubject(r), merchant: r.merchant, monthlyCents: r.monthlyCents, lastDate: r.lastDate, rowIds: r.transactionIds }));
};

// the numbers Säästövinkit waits for, while the module is on: the page itself asks nothing
const inputs: Source = async (s, userId) =>
  s.instance.enabled("optimise") ? (await neededInputs(s, userId)).map((n) => ({ kind: "input", id: `input:${n.key}`, cents: n.cents, key: n.key, def: n.def, subject: n.subject, old: n.old })) : [];

// no money rides on the answer, so the question comes last; a household with no rows yet is asked nothing
const mortgage: Source = async (s, userId) => {
  const { ctx, accounts } = await s.analysis.get(s, userId, "own");
  if (!ctx.txs.length) return [];
  const { balances, inputs } = await requestInputs(s, userId, accounts);
  return buildHousing(ctx, balances, inputs)?.ask ? [{ kind: "mortgage", id: "mortgage", cents: 0 }] : [];
};

const SOURCES: readonly Source[] = [front, loans, splits, subscriptions, inputs, mortgage];

/** The whole queue, the most money first; the page caps a sitting. */
export async function reviewQueue(s: Services, userId: string): Promise<Review> {
  const lists = await Promise.all(SOURCES.map((source) => source(s, userId)));
  const { ctx } = await s.analysis.get(s, userId, "own");
  const byId = new Map(ctx.txs.map((t) => [t.id, t]));
  const items = lists
    .flat()
    .map(({ rowIds, whole, ...item }): ReviewItem => {
      if (!rowIds) return item;
      const rows = rowIds.flatMap((id) => byId.get(id) ?? []).sort((a, b) => (a.bookingDate < b.bookingDate ? 1 : a.bookingDate > b.bookingDate ? -1 : 0));
      return { ...item, rowCount: rows.length, rows: rows.slice(0, ROWS).map((t) => ({ id: t.id, date: t.bookingDate, cents: whole ? billCents(t) : t.amountCents, name: t.merchant, text: t.description || t.counterparty || "" })) };
    })
    .sort((a, b) => b.cents - a.cents || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { items };
}
