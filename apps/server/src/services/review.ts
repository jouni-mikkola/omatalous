/**
 * Tarkistettavat: every question the app cannot settle itself, in one queue ordered by the money at stake. Each source
 * keeps its own answer route (rules, payer roles, marks, loans, account answers); this only gathers and orders, so an
 * answer given here changes what the old card's answer changed.
 */
import { addDays, type AnalysisTx, billCents, buildHousing, buildQuestions, cancelledSubjects, countingMark, dueConsents, fromDayNumber, getCategory, type GuessCandidate, householdWords, isBillSeries, isCancelled, isUnknownMerchant, type LoanKind, lenderInstalments, marksBySubject, netSpend, newCharges, openPriceRises, payeeGuesser, payerRoleOf, type RecurringSeries, seriesMarkSubject } from "@banking/core";
import { connectionView } from "./accounts.ts";
import { proposalsFor, requestInputs, usesWithTraces } from "./analysis.ts";
import type { Services } from "./context.ts";
import { industryMap } from "./enrich.ts";
import { settledTrace } from "./money-trace.ts";
import { reconcileOf } from "./reconcile.ts";

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
 * A payee of Muut menot or Muut tulot: a category for it (POST /api/rules) or "Älä kysy tästä enää" (mark `question:payee:`).
 * `picks` are the categories offered first: the guess when there is one (`payeeGuesser`, core payee-guess.ts), then the
 * categories the household uses most on that side, which are no guess about the payee.
 */
type PayeeItem = Base & Omit<PayeeAsked, "cents" | "rowIds"> & { picks: string[]; guess?: Pick<GuessCandidate, "category" | "reason"> };

/** Money from a payer no role answers: PUT /api/payer-roles. `proposal` is the app's guess. */
type PayerItem = Base & Omit<PayerAsked, "cents" | "offMedianCents" | "rowIds">;

/**
 * A monthly payment to a lender nobody saved as a loan. Placed: the app knows what it is and asks to save it
 * (POST /api/loans). Not placed: "Mikä laina tämä on?" (mark `question:loan-kind:`). "Ei ole laina" either way.
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

/**
 * A regular charge to decide on, Käytössä or Lopetettu (mark on `subject`), one item a series whatever it has to say.
 * `reason` is why it is asked: its price rose (`price`: the old and the new charge and the day of the change), it began
 * lately (`since`: its first charge), or it is small and has run half a year with no mark (`quiet`). A series with more
 * than one of these is asked once, by the first of them, and carries the figures of each.
 */
interface SubscriptionItem extends Base {
  kind: "subscription";
  reason: "price" | "new" | "quiet";
  price?: { fromCents: number; toCents: number; date: string };
  since?: string;
  seriesId: string;
  subject: string;
  merchant: string;
  monthlyCents: number;
  lastDate: string;
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
 * An account whose rows do not add up to the bank's balances (`reconcile`, core): the newest stretch between two
 * balances, the bank's change over it and the rows' sum. `cents` is what they differ by. It goes when the rows add up
 * again (a fetch, a file from the bank); there is no mark that hides it.
 */
interface BalanceItem extends Base {
  kind: "balance";
  accountId: string;
  accountName: string;
  fromDay: string;
  toDay: string;
  bankCents: number;
  rowsCents: number;
}

/**
 * A bank consent that ended or ends within core's `WARN_DAYS` (`dueConsents`): connect the bank again (POST
 * /api/connections/start). `daysLeft` is null for one that ended. `cents` is the money that moved on its accounts in the
 * last 365 days, which is what the app stops seeing.
 */
interface ConsentItem extends Base {
  kind: "consent";
  connection: string;
  institution: string;
  daysLeft: number | null;
  accounts: string[];
}

/**
 * A bill or subscription whose charge is late (core `isOverdue`): `dueDate` is the day it was expected and `cents` its
 * usual charge. It goes when the charge comes or the series is marked Lopetettu (mark `cancelled` on `subject`).
 */
interface BillItem extends Base {
  kind: "bill";
  seriesId: string;
  subject: string;
  merchant: string;
  dueDate: string;
}

/**
 * A row of Muut menot or Muut tulot with no payee name, so no payee's question covers it and no rule can: a category
 * for the one row (PATCH /api/transactions/:id). `picks` as a payee's, with no guess.
 */
interface RowItem extends Base {
  kind: "row";
  rowId: string;
  side: "out" | "in";
  date: string;
  picks: string[];
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

type ReviewItem = PayeeItem | PayerItem | LoanItem | PlanItem | SplitItem | SubscriptionItem | MortgageItem | BalanceItem | ConsentItem | BillItem | RowItem | ExtensionItem;

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

/** How many quick picks a payee's question offers before "Muu kategoria…". */
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

// a plan is asked its end once; a loan is asked until it is saved or marked "Ei ole laina". Its rows are its series' own, at the
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

// the price rises and new regular charges the overview's Huomioitavaa told (core `openPriceRises`, `newCharges`) and the
// quiet small subscriptions, by series: one that is two of these is one item, so no finding is in the queue twice. The
// money at stake is the year of the charge, or for a rise alone what the rise adds to a year.
const subscriptions: Source = async (s, userId) => {
  const { ctx, accounts } = await s.analysis.get(s, userId, "own");
  const [{ inputs }, stored] = await Promise.all([requestInputs(s, userId, accounts), s.finance(userId).listMarks()]);
  const marks = marksBySubject(stored);
  const found = new Map<string, { r: RecurringSeries; cents: number; price?: SubscriptionItem["price"]; since?: string; quiet?: true }>();
  const of = (r: RecurringSeries, cents: number) => {
    const f = found.get(r.id) ?? { r, cents: 0 };
    f.cents = Math.max(f.cents, cents);
    found.set(r.id, f);
    return f;
  };
  for (const { series, yearlyCents } of openPriceRises(ctx, ctx.today, inputs)) {
    const { fromCents, toCents, date } = series.priceChange!;
    of(series, yearlyCents).price = { fromCents, toCents, date };
  }
  for (const { series } of newCharges(ctx, ctx.today, inputs)) of(series, series.yearlyCents).since = series.firstDate;
  for (const r of ctx.recurring) if (r.review && !countingMark(marks, r, ctx.today)) of(r, r.yearlyCents).quiet = true;
  return [...found.values()].map(({ r, cents, price, since }): Sourced => ({
    kind: "subscription",
    id: `subscription:${r.id}`,
    cents,
    reason: price ? "price" : since ? "new" : "quiet",
    ...(price && { price }),
    ...(since && { since }),
    seriesId: r.id,
    subject: seriesMarkSubject(r),
    merchant: r.merchant,
    monthlyCents: r.monthlyCents,
    lastDate: r.lastDate,
    rowIds: r.transactionIds,
  }));
};

// no money rides on the answer, so the question comes last; a household with no rows yet is asked nothing
const mortgage: Source = async (s, userId) => {
  const { ctx, accounts } = await s.analysis.get(s, userId, "own");
  if (!ctx.txs.length) return [];
  const { balances, inputs } = await requestInputs(s, userId, accounts);
  return buildHousing(ctx, balances, inputs)?.ask ? [{ kind: "mortgage", id: "mortgage", cents: 0 }] : [];
};

// the member's own accounts, each by its newest stretch: an older difference with a matched stretch after it is proved over.
// Only a stretch core says differs: one it says nothing of (`unknown`: rows asked from a later day, foreign rows) is no
// item, and two differences that cancel out are one matched stretch there (`mark`), so they are none either.
const balances: Source = async (s, userId) => {
  const accounts = await s.finance(userId).listAccounts();
  const results = await reconcileOf(s, userId, accounts);
  return accounts.flatMap((a): Sourced[] => {
    const r = results.get(a.id);
    const newest = r?.status === "differs" ? r.intervals[r.intervals.length - 1] : undefined;
    if (!newest || newest.state !== "differs" || newest.diffCents === 0) return [];
    return [{ kind: "balance", id: `balance:${a.id}`, cents: Math.abs(newest.diffCents), accountId: a.id, accountName: a.name, fromDay: newest.fromDay, toDay: newest.toDay, bankCents: newest.deltaCents, rowsCents: newest.sumCents }];
  });
};

// every consent that is due, whether or not its bank can be started by id: the round of Asetukset renews those that can
const consents: Source = async (s, userId) => {
  const repo = s.finance(userId);
  const [accounts, connections, { ctx }] = await Promise.all([repo.listAccounts(), repo.listConnections(), s.analysis.get(s, userId, "own")]);
  const today = s.today();
  const views = connections.map((c) => connectionView(c, today, s.instance.current.timezone, accounts, connections));
  const from = addDays(today, -365);
  return dueConsents(views, (institution) => institution, new Set(views.map((v) => v.institution))).flatMap(({ connection }): Sourced[] => {
    const v = views.find((o) => o.id === connection)!;
    const own = accounts.filter((a) => a.connectionId === v.id);
    const ids = new Set(own.map((a) => a.id));
    const cents = ctx.txs.reduce((sum, t) => (ids.has(t.accountId) && t.status === "booked" && t.bookingDate >= from ? sum + Math.abs(t.amountCents) : sum), 0);
    return [{ kind: "consent", id: `consent:${v.id}`, cents, connection: v.id, institution: v.institution, daysLeft: v.daysLeft, accounts: own.map((a) => a.name) }];
  });
};

// the late bills of Tässä kuussa: a live series nobody marked as ended whose next charge did not come
const bills: Source = async (s, userId) => {
  const { ctx, accounts } = await s.analysis.get(s, userId, "own");
  const cancelled = cancelledSubjects((await requestInputs(s, userId, accounts)).inputs, ctx.today);
  return ctx.recurring
    .flatMap((r): Sourced[] => (r.overdue && r.nextDate && isBillSeries(r) && !isCancelled(cancelled, r) ? [{ kind: "bill", id: `bill:${r.id}`, cents: r.typicalAmountCents, seriesId: r.id, subject: seriesMarkSubject(r), merchant: r.merchant, dueDate: r.nextDate }] : []));
};

// the rows the payees' questions leave out for having no name (core `buildQuestions`), one row an item, under its
// conditions: its window (365 days, today among them, so from 364 days back; the picks count from 365 back as the
// payees' do in `front`), and for money in no row whose payer has a role, which is the role's to say, nor one a payer's
// question asks of already (a payer known by its IBAN alone). Its income types (unknown, other income) are all a
// default row of Muut tulot can be, so the category says that.
const rows: Source = async (s, userId) => {
  const { ctx, accounts } = await s.analysis.get(s, userId, "own");
  const { inputs } = await requestInputs(s, userId, accounts);
  const { payers } = inputs;
  const today = s.today();
  const asked = new Set(buildQuestions(ctx, { from: today, to: today }, inputs, [], Infinity).items.flatMap((q) => (q.kind === "payer" ? q.rowIds : [])));
  const from = addDays(today, -364);
  const picks = usedMost(ctx.txs, addDays(today, -365));
  return ctx.txs.flatMap((t): Sourced[] => {
    if (t.bookingDate < from || t.status !== "booked" || t.isTransfer || t.categorySource !== "default" || !isUnknownMerchant(t.merchant)) return [];
    const out = t.category === "other" && t.spend > 0 ? netSpend(t) : 0;
    const answered = t.amountCents > 0 && payers !== undefined && (asked.has(t.id) || payerRoleOf(payers.roles, t, payers.memberId) !== null);
    const cents = out || (t.category === "income" && !answered ? t.flows.income : 0);
    if (cents <= 0) return [];
    const side = out ? "out" : "in";
    return [{ kind: "row", id: `row:${t.id}`, cents, rowId: t.id, side, date: t.bookingDate, picks: picks[side], rowIds: [t.id] }];
  });
};

const SOURCES: readonly Source[] = [front, loans, splits, subscriptions, mortgage, balances, consents, bills, rows];

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

/**
 * How many items are open, which is what the tab's mark and the page's title both say: the whole queue, each kind
 * a source sends having its card on the page, so the mark falls to zero when the page is empty. `extension` has no
 * card there (apps/web review-items.ts `KINDS`) and no source: one that starts to send it needs the card first.
 */
export async function reviewCount(s: Services, userId: string): Promise<{ count: number }> {
  return { count: (await reviewQueue(s, userId)).items.length };
}
