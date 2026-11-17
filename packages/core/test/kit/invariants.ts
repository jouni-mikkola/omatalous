/**
 * The invariants of the figures, judged over a generated household and each of its views (generate.ts, viewsOf). A check
 * returns the violations it finds; it never throws. invariants.generated.test.ts sets them against known-violations.ts,
 * so a finding that is listed there must keep failing and nothing else may fail.
 *
 * I1 and I1b read the rows and the pool (src/analysis/conservation.ts, pool.ts), I3 the verdicts against the labels of
 * the generator, I4 the sum of the members against the household, I5 the proof of the balances. I6 reads a pool cut by
 * who paid, which the generator makes no household of: it takes the pool's rows and trace itself. I7 reads the monthly
 * series of the reports over a range that starts before the data: an unknown month is never 0.
 * Each check is exported
 * so a test can hand it a household made wrong on purpose and see it fail (invariants.teeth.test.ts).
 */
import { aheadBasis } from "../../src/analysis/ahead.ts";
import { bridgeByMonth } from "../../src/analysis/conservation.ts";
import { createContext } from "../../src/analysis/context.ts";
import { leftOf } from "../../src/analysis/flows.ts";
import { monthKnown } from "../../src/analysis/coverage.ts";
import { dataQualityReport } from "../../src/analysis/data-quality.ts";
import { poolOf } from "../../src/analysis/pool.ts";
import { buildQuestions } from "../../src/analysis/questions.ts";
import { getCategory } from "../../src/categories.ts";
import { normalizeIban } from "../../src/iban.ts";
import { loanProposals } from "../../src/loan-detect.ts";
import { applyUse } from "../../src/account-use.ts";
import type { Owner, RowParts } from "../../src/money-trace.ts";
import { paidRows } from "../../src/money-trace-answers.ts";
import { buildReports } from "../../src/reports/index.ts";
import { standingCut } from "../../src/standing-cut.ts";
import { WALLET_PAYER_KEY } from "../../src/payer-role.ts";
import { type Account, NO_INPUTS, type Part, type Transaction } from "../../src/types.ts";
import { type HouseholdView, viewsOf } from "../../../../tools/findings/households.ts";
import { proveAccount } from "./generate.ts";
import type { GeneratedHousehold, Truth } from "./truth.ts";

export type Check =
  | "I6.standing-sum"
  | "I1.bridge"
  | "I1.pool-accounts"
  | "I1.pool-balance"
  | "I1.pool-cards"
  | "I1b.member-legs"
  | "I1c.own-transfer"
  | "I3.labelled-flow"
  | "I3a.money-in"
  | "I3b.prefix"
  | "I3c.wallet-role"
  | "I3d.namesake"
  | "I4.loan-parts"
  | "I5.unproven"
  | "I7.unknown-month";

/** One failed invariant: where it failed and the line that says what. */
export interface Violation {
  check: Check;
  household: string;
  /** "household" or the member id. */
  view: string;
  /** `YYYY-MM` for a check that runs by month. */
  month: string | null;
  line: string;
}

const RANGE = (h: GeneratedHousehold) => ({ from: "2026-01-01", to: h.today });
const viewName = (v: HouseholdView) => v.member ?? "household";
const found = (check: Check, h: GeneratedHousehold, v: HouseholdView, line: string, month: string | null = null): Violation => ({ check, household: h.name, view: viewName(v), month, line });

/**
 * I1: in every month, the edges of the history included, Tulos is the change of the pool, less the two named lines (the
 * cards and the moves between daily accounts). The line of a finding names the residual, the moved line and what the
 * accounts outside the pool counted. The cards line is left out: it changes with every purchase, is no finding of its
 * own, and the residual already has it taken off.
 */
export function conservation(h: GeneratedHousehold, v: HouseholdView): Violation[] {
  const pool = poolOf(v.balances);
  const daily = new Set(h.accounts.filter((a) => a.type === "checking").map((a) => normalizeIban(a.iban)).filter((i): i is string => i !== null));
  // A bank often gives no payer account on money in, so the generated rows carry none. The bridge names the legs of a move by both
  // accounts, and the label of the generator knows the other leg, so the leg's counterparty is read from it here.
  const ibanOf = new Map(h.accounts.map((a) => [a.id, a.iban]));
  const accountOf = new Map(h.txs.map((t) => [t.id, t.accountId]));
  const withPayer = v.ctx.txs.map((t) => {
    const other = t.counterpartyIban ? undefined : h.truth.get(t.id)?.pair;
    const iban = other ? ibanOf.get(accountOf.get(other) ?? "") : null;
    return iban ? { ...t, counterpartyIban: iban } : t;
  });
  return bridgeByMonth(withPayer, v.accounts, pool.ids, daily)
    .filter((m) => m.residualCents !== 0)
    .map((m) => found("I1.bridge", h, v, `residual ${m.residualCents}, moved ${m.lines.moved.cents}, outside the pool ${m.counted.map((l) => `${l.accountType}:${l.flow} ${l.cents}`).join(", ") || "none"}`, m.month));
}

/**
 * I1 and D1: Tulos and Käytettävissä speak for one pool: the same accounts, the sum they hold, and a card's debt is
 * taken off only when the pool pays the card's bills (the labels of the card bills say from which account).
 */
export function onePool(h: GeneratedHousehold, v: HouseholdView, poolIds: ReadonlySet<string> = poolOf(v.balances).ids): Violation[] {
  const pool = poolOf(v.balances);
  const basis = aheadBasis(v.ctx, v.balances, NO_INPUTS);
  const out: Violation[] = [];
  const counted = basis.checking.map((c) => c.id).sort().join("+");
  const whole = [...pool.ids].sort().join("+");
  if (counted !== whole) out.push(found("I1.pool-accounts", h, v, `Käytettävissä counts ${counted || "no account"}, the pool is ${whole}`));
  const start = basis.ahead.balance?.startCents;
  if (start !== undefined && start !== pool.cents) out.push(found("I1.pool-balance", h, v, `Käytettävissä starts from ${start}, the pool holds ${pool.cents}`));
  const payers = billPayers(h);
  // I1.pool-cards judges the card debt against the pool of Tulos (`poolIds`), not against the accounts Käytettävissä counts.
  // That is valid only while I1.pool-accounts reports the difference between the two: a card can pass here and still be
  // paid from an account Käytettävissä leaves out. When that check passes, the two are the same accounts.
  for (const debt of basis.ahead.balance?.cardDebts ?? []) {
    const from = [...(payers.get(debt.cardId) ?? [])].sort();
    if (!from.some((id) => poolIds.has(id))) out.push(found("I1.pool-cards", h, v, `Käytettävissä takes off ${debt.cents} of ${debt.cardId}, whose bills are paid from ${from.join("+") || "no account"}, outside the pool`));
  }
  return out;
}

/** The accounts that pay each card's bills, from the labels: the other leg of every card-bill row of the card. */
function billPayers(h: GeneratedHousehold): Map<string, Set<string>> {
  const accountOf = new Map(h.txs.map((t) => [t.id, t.accountId]));
  const out = new Map<string, Set<string>>();
  for (const t of h.txs) {
    const label = h.truth.get(t.id);
    const payer = label?.kind === "card_bill" && label.pair ? accountOf.get(label.pair) : undefined;
    if (!payer || h.accounts.find((a) => a.id === t.accountId)?.type !== "credit_card") continue;
    (out.get(t.accountId) ?? out.set(t.accountId, new Set()).get(t.accountId)!).add(payer);
  }
  return out;
}

/** I1b: in the household view a row the generator labelled a transfer or a mirror (between members, own accounts, a card's bill, a loan's own row) is neither income nor spending, save the bank fee its label names (`feeCents`), which is the payer's spending exactly. */
export function memberLegs(h: GeneratedHousehold, v: HouseholdView): Violation[] {
  if (v.view !== "household") return [];
  const moved = v.ctx.txs.filter((t) => ["transfer", "mirror"].includes(h.truth.get(t.id)?.flow ?? "") && (t.flows.income !== 0 || t.flows.consumption !== (h.truth.get(t.id)?.feeCents ?? 0) || t.flows.debt !== 0));
  const kinds = [...new Set(moved.map((t) => h.truth.get(t.id)!.kind))].sort();
  return moved.length ? [found("I1b.member-legs", h, v, `${moved.length} legs (${kinds.join("/")}) count as ${[...new Set(moved.map((t) => t.category))].sort().join("/")}`)] : [];
}

/**
 * I1c: a row the generator labelled an own transfer is a transfer in every view, the household's and each member's:
 * never income, a refund or spending. Both legs are on one member's accounts, so a member's view holds the pair. The
 * joint account's in-leg has no member (`member: null`) and is the other member's own view's too; each view that
 * holds a labelled leg is judged on that leg alone.
 */
export function ownTransfers(h: GeneratedHousehold, v: HouseholdView): Violation[] {
  const read = v.ctx.txs.filter((t) => h.truth.get(t.id)?.kind === "own_transfer" && t.amountCents !== 0 && !t.isTransfer);
  return read.length ? [found("I1c.own-transfer", h, v, `${read.length} legs (own_transfer) read as ${[...new Set(read.map((t) => `${t.amountCents > 0 ? "in" : "out"} ${t.category}`))].sort().join("/")}`)] : [];
}

const PREFIX = "MOBILEPAY ";
const isOutflow = (category: string): boolean => ["expense", "debt"].includes(getCategory(category).kind);

/** I3a: money in does not sit in a category of money out, unless the labels say it is a refund or the household set it. */
export function moneyIn(h: GeneratedHousehold, v: HouseholdView): Violation[] {
  // money from a person nets against what was sent to people in its month (`netPersons`): it sits in Maksut henkilöille then
  const bad = v.ctx.txs.filter((t) => t.amountCents > 0 && !t.isTransfer && isOutflow(t.category) && t.categorySource !== "user" && h.truth.get(t.id)?.kind !== "refund" && h.truth.get(t.id)?.kind !== "person");
  const by = new Map<string, number>();
  for (const t of bad) {
    const what = `${t.counterparty ?? "no sender"} as ${t.category}`;
    by.set(what, (by.get(what) ?? 0) + 1);
  }
  return [...by].map(([what, n]) => found("I3a.money-in", h, v, `${n} rows in, ${what}`));
}

/** What the engine counted of a row that the label of its flow can be judged by: the sign of each flow, in the one word that names the wrong ones. */
function wrongFlow(label: Truth, t: HouseholdView["ctx"]["txs"][number]): string | null {
  const f = t.flows;
  // a refund is judged by I3a, and a transfer or a mirror by I1b; a row cut to nothing says nothing
  if (t.amountCents === 0 || label.kind === "refund") return null;
  // money from a person counts as spending below zero where the month sent as much (`netPersons`)
  if (label.flow === "income" && label.kind === "person" && f.income === 0 && f.consumption < 0 && f.debt === 0) return null;
  if (label.flow === "income") return f.income > 0 && f.consumption === 0 && f.debt === 0 ? null : `income counted as income ${f.income}, consumption ${f.consumption}, debt ${f.debt}`;
  if (label.flow === "consumption") return f.consumption > 0 && f.income === 0 && f.debt === 0 ? null : `consumption counted as income ${f.income}, consumption ${f.consumption}, debt ${f.debt}`;
  if (label.flow === "debt") return f.debt > 0 && f.income === 0 && f.consumption === 0 ? null : `debt counted as income ${f.income}, consumption ${f.consumption}, debt ${f.debt}`;
  return null;
}

/** I3: every labelled row of income, spending or debt is counted as what its label says, and only that. A debt paid from a savings account counts nothing: the money was counted as saved when it left the pool. */
export function labelledFlow(h: GeneratedHousehold, v: HouseholdView): Violation[] {
  const by = new Map<string, number>();
  const savings = new Set(v.accounts.filter((a) => a.type === "savings").map((a) => a.id));
  for (const t of v.ctx.txs) {
    const label = h.truth.get(t.id);
    if (label?.flow === "debt" && savings.has(t.accountId) && leftOf(t.flows) === 0) continue;
    const wrong = label && wrongFlow(label, t);
    if (wrong) by.set(`${label.kind} ${wrong}`, (by.get(`${label.kind} ${wrong}`) ?? 0) + 1);
  }
  return [...by].sort().map(([what, n]) => found("I3.labelled-flow", h, v, `${n} rows: ${what}`));
}

/** I3d: money from a stranger with a member's name is a person's payment in: never a transfer between the household's own accounts, and counted as income. */
export function namesake(h: GeneratedHousehold, v: HouseholdView): Violation[] {
  const rows = v.ctx.txs.filter((t) => h.truth.get(t.id)?.event === "namesake" && t.amountCents !== 0);
  // income, or spending below zero where the month sent as much to people (`netPersons`)
  const bad = rows.filter((t) => t.isTransfer || (t.flows.income <= 0 && t.flows.consumption >= 0));
  return bad.length ? [found("I3d.namesake", h, v, `${bad.length} of ${rows.length} payments from a namesake are ${bad.every((t) => t.isTransfer) ? "a transfer" : "not income"}`)] : [];
}

/**
 * I3b: a payment-app prefix does not make a business a person. The labels decide: a business is never a person and a
 * person is, and the payee is a person with the prefix exactly when it is one without it.
 */
export function prefix(h: GeneratedHousehold, v: HouseholdView): Violation[] {
  const out: Violation[] = [];
  const byLabel = new Map<string, number>();
  for (const t of v.ctx.txs) {
    const label = h.truth.get(t.id);
    if (!label || t.amountCents >= 0 || !t.counterparty) continue;
    const person = t.category === "p2p";
    if ((label.kind === "business" && person) || (label.kind === "person" && !person)) byLabel.set(`${t.counterparty} is a ${label.kind} and counts as ${t.category}`, (byLabel.get(`${t.counterparty} is a ${label.kind} and counts as ${t.category}`) ?? 0) + 1);
  }
  for (const [what, n] of [...byLabel].sort()) out.push(found("I3b.prefix", h, v, `${n} rows: ${what}`));
  const people = new Map<string, Set<boolean>>();
  for (const t of v.ctx.txs) {
    if (t.amountCents >= 0 || !t.counterparty) continue;
    (people.get(t.counterparty) ?? people.set(t.counterparty, new Set()).get(t.counterparty)!).add(t.category === "p2p");
  }
  for (const [name, own] of people) {
    const bare = name.startsWith(PREFIX) ? people.get(name.slice(PREFIX.length)) : undefined;
    if (bare && [...own].some((p) => !bare.has(p))) out.push(found("I3b.prefix", h, v, `with the prefix ${name} is ${own.has(true) ? "a person" : "a payee"}, without it ${name.slice(PREFIX.length)} is ${bare.has(true) ? "a person" : "a payee"}`));
  }
  return out;
}

type WalletQuestion = Extract<ReturnType<typeof buildQuestions>["items"][number], { kind: "payer" }>;

/**
 * The questions the review asks of the wallet payer in a view. The wallet's payments in are read as the labels say
 * (a person's payment in), since the figures count them as spending taken back today (a finding of its own, I3) and a
 * row counted as that is never asked about as a payer, which would leave this check nothing to look at.
 */
export function walletQuestions(h: GeneratedHousehold, v: HouseholdView): WalletQuestion[] {
  const rows = v.txs.map((t) => (h.truth.get(t.id)?.event === "payment-app" && h.truth.get(t.id)?.kind === "person" && t.amountCents > 0 ? { ...t, category: "p2p_in", categorySource: "default" as const, isTransfer: false } : t));
  const ctx = createContext(rows, v.accounts, h.today);
  const asked = buildQuestions(ctx, RANGE(h), { ...NO_INPUTS, payers: { memberId: viewName(v), roles: [] } }, [], Infinity);
  return asked.items.filter((i): i is WalletQuestion => i.kind === "payer" && i.key === WALLET_PAYER_KEY);
}

/** I3c: the payer of the wallet has no account, so the question never offers it as the member's own money. */
export function walletRole(h: GeneratedHousehold, v: HouseholdView, asked: readonly WalletQuestion[] = walletQuestions(h, v)): Violation[] {
  return asked.filter((i) => i.options.includes("own_money") || i.proposal === "own_money").map(() => found("I3c.wallet-role", h, v, "the wallet payer is offered own_money"));
}

/** The monthly sum of each loan the views propose, by the loan's key. */
export const monthlyLoans = (v: HouseholdView): Map<string, number> => new Map(loanProposals(v.ctx, NO_INPUTS).map((p) => [p.key, p.monthlyCents]));

/** I4: the monthly sum of a loan in the household view is what its members' views add up to. */
export function loanParts(h: GeneratedHousehold, views: readonly HouseholdView[]): Violation[] {
  const monthly = monthlyLoans;
  const [whole, ...members] = views;
  if (!whole || !members.length) return [];
  const parts = members.map(monthly);
  return [...monthly(whole)].flatMap(([key, cents]) => {
    const sum = parts.reduce((s, p) => s + (p.get(key) ?? 0), 0);
    return sum === cents ? [] : [found("I4.loan-parts", h, whole, `${key}: household ${cents}, members ${sum}`)];
  });
}

/** I5: an account whose balance no reference day proves is told in the data-quality list, as it is for a proved one. */
export function unproven(h: GeneratedHousehold, twin: GeneratedHousehold): Violation[] {
  const unknown = h.accounts.filter((a) => proveAccount(h, a.id)?.status === "unknown");
  if (!unknown.length) return [];
  const [v, other] = [viewsOf(h)[0]!, viewsOf(twin)[0]!];
  const said = (x: HouseholdView, g: GeneratedHousehold) => JSON.stringify(dataQualityReport(x.ctx, RANGE(g), x.balances).signals.map((s) => [s.id, s.title, s.detail]));
  return said(v, h) === said(other, twin) ? [found("I5.unproven", h, v, `${unknown.length} accounts have no proof (${proveAccount(h, unknown[0]!.id)?.reason}) and the report says nothing`)] : [];
}

/** A pool cut by who paid, as the members' own views read it: the bank's rows, the trace of them, and each member's owner key and part of the account. */
export interface SourcePool {
  account: Account;
  rows: readonly Transaction[];
  trace: readonly RowParts[];
  members: readonly { owner: Owner; part: Part }[];
}

/**
 * I6: for a pool cut by who paid, the members' standing amounts of each row (what a series is read from for what is
 * ahead) add up to the bank's whole amount of it, the money nobody owns included: never more, and no cent lost. A row
 * a member has no part of counts 0 for them. `cut` is what is judged.
 */
export function standingSum(name: string, pool: SourcePool, cut: typeof standingCut = standingCut): Violation[] {
  const sums = new Map<string, number>();
  for (const m of pool.members) {
    const parts = new Map([[pool.account.id, m.part]]);
    const standing = cut(applyUse(pool.rows, [pool.account], parts), parts, paidRows(pool.trace, m.owner));
    for (const t of standing) sums.set(t.id, (sums.get(t.id) ?? 0) + t.amountCents);
  }
  return pool.rows.flatMap((t) => {
    const sum = sums.get(t.id) ?? 0;
    return sum === t.amountCents ? [] : [{ check: "I6.standing-sum" as const, household: name, view: "members", month: null, line: `${t.id}: the bank's ${t.amountCents}, the members' standing amounts add up to ${sum}` }];
  });
}

/**
 * I7: a month the data does not reach (`monthKnown`) has no figure in a report's monthly series: null, never 0. The
 * range starts long before any generated household, so its first months are unknown. `reports` is a parameter so a test
 * can hand the check reports made wrong on purpose.
 */
export function unknownMonth(h: GeneratedHousehold, v: HouseholdView, reports: typeof buildReports = buildReports): Violation[] {
  const r = reports({ ctx: v.ctx, range: { from: "2020-01-01", to: h.today }, balances: v.balances }, ["spendingMonths", "income", "balances"]);
  const out: Violation[] = [];
  const check = (report: string, series: string, months: readonly string[], values: readonly (number | null)[]) =>
    months.forEach((month, i) => {
      if (!monthKnown(v.ctx, month) && values[i] !== null) out.push(found("I7.unknown-month", h, v, `${report} ${series} is ${values[i]} in a month the data does not reach`, month));
    });
  const s = r.spendingMonths;
  check("spendingMonths", "totals", s.months, s.totals);
  check("spendingMonths", "fromSavings", s.months, s.fromSavings);
  for (const c of s.categories) check("spendingMonths", c.category, s.months, c.values);
  const months = r.income.months.map((m) => m.month);
  check("income", "total", months, r.income.months.map((m) => m.totalCents));
  check("income", "earned", months, r.income.months.map((m) => m.earnedCents));
  check("income", "usual", months, r.income.months.map((m) => m.usualCents));
  for (const t of r.income.types) check("income", t.type, months, t.months);
  for (const k of r.income.kinds) check("income", k.id, months, k.months);
  const b = r.balances;
  check("balances", "total", b.months, b.total);
  check("balances", "change", b.months, b.monthChange);
  check("balances", "less debt", b.months, b.accountsLessDebt);
  return out;
}

/** Every violation of a household, in each view; `twin` is the same household with reference days, for I5. */
export function violationsOf(h: GeneratedHousehold, twin?: GeneratedHousehold): Violation[] {
  const views = viewsOf(h);
  return [...views.flatMap((v) => [...conservation(h, v), ...onePool(h, v), ...memberLegs(h, v), ...ownTransfers(h, v), ...labelledFlow(h, v), ...moneyIn(h, v), ...prefix(h, v), ...namesake(h, v), ...walletRole(h, v), ...unknownMonth(h, v)]), ...loanParts(h, views), ...(twin ? unproven(h, twin) : [])];
}
