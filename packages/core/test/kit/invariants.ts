/**
 * The invariants of the figures, judged over a generated household and each of its views (generate.ts, viewsOf). A check
 * returns the violations it finds; it never throws. invariants.generated.test.ts sets them against known-violations.ts,
 * so a finding that is listed there must keep failing and nothing else may fail.
 *
 * I1 and I1b read the rows and the pool (src/analysis/conservation.ts, pool.ts), I3 the verdicts against the labels of
 * the generator, I4 the sum of the members against the household, I5 the proof of the balances.
 */
import { aheadBasis } from "../../src/analysis/ahead.ts";
import { bridgeByMonth } from "../../src/analysis/conservation.ts";
import { dataQualityReport } from "../../src/analysis/data-quality.ts";
import { poolOf } from "../../src/analysis/pool.ts";
import { buildQuestions } from "../../src/analysis/questions.ts";
import { getCategory } from "../../src/categories.ts";
import { normalizeIban } from "../../src/iban.ts";
import { loanProposals } from "../../src/loan-detect.ts";
import { WALLET_PAYER_KEY } from "../../src/payer-role.ts";
import { NO_INPUTS } from "../../src/types.ts";
import { type HouseholdView, viewsOf } from "../../../../tools/findings/households.ts";
import { proveAccount } from "./generate.ts";
import type { GeneratedHousehold } from "./truth.ts";

export type Check =
  | "I1.bridge"
  | "I1.pool-accounts"
  | "I1.pool-balance"
  | "I1b.member-legs"
  | "I3a.money-in"
  | "I3b.prefix"
  | "I3c.wallet-role"
  | "I4.loan-parts"
  | "I5.unproven";

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

/** I1: in each month the rows that crossed no boundary add up to the change of the pool and the cards. */
function conservation(h: GeneratedHousehold, v: HouseholdView): Violation[] {
  const pool = poolOf(v.balances);
  const daily = new Set(h.accounts.filter((a) => a.type === "checking").map((a) => normalizeIban(a.iban)).filter((i): i is string => i !== null));
  // the first and the last month are partial: a leg that pairs across the edge of the history is cut there
  return bridgeByMonth(v.ctx.txs, v.accounts, pool.ids, daily)
    .slice(1, -1)
    .filter((m) => m.residualCents !== 0)
    .map((m) => found("I1.bridge", h, v, `residual ${m.residualCents}, boundary ${m.boundary.map((l) => `${l.accountType}:${l.flow} ${l.cents}`).join(", ") || "none"}`, m.month));
}

/** I1 and D1: Tulos and Käytettävissä speak for one pool: the same accounts and the sum they hold. */
function onePool(h: GeneratedHousehold, v: HouseholdView): Violation[] {
  const pool = poolOf(v.balances);
  const basis = aheadBasis(v.ctx, v.balances, NO_INPUTS);
  const out: Violation[] = [];
  const counted = basis.checking.map((c) => c.id).sort().join("+");
  const whole = [...pool.ids].sort().join("+");
  if (counted !== whole) out.push(found("I1.pool-accounts", h, v, `Käytettävissä counts ${counted || "no account"}, the pool is ${whole}`));
  const start = basis.ahead.balance?.startCents;
  if (start !== undefined && start !== pool.cents) out.push(found("I1.pool-balance", h, v, `Käytettävissä starts from ${start}, the pool holds ${pool.cents}`));
  return out;
}

/** I1b: a transfer the generator labelled as moved between members is neither income nor spending in the household view. */
function memberLegs(h: GeneratedHousehold, v: HouseholdView): Violation[] {
  if (v.view !== "household") return [];
  const bad = v.ctx.txs.filter((t) => h.truth.get(t.id)?.kind === "member_transfer" && (t.flows.income !== 0 || t.flows.consumption !== 0 || t.flows.debt !== 0));
  return bad.length ? [found("I1b.member-legs", h, v, `${bad.length} legs between members count as ${[...new Set(bad.map((t) => t.category))].sort().join("/")}`)] : [];
}

const PREFIX = "MOBILEPAY ";
const isOutflow = (category: string): boolean => ["expense", "debt"].includes(getCategory(category).kind);

/** I3a: money in does not sit in a category of money out, unless a return pair took it back or the household set it. */
function moneyIn(h: GeneratedHousehold, v: HouseholdView): Violation[] {
  const bad = v.ctx.txs.filter((t) => t.amountCents > 0 && !t.isTransfer && isOutflow(t.category) && t.categorySource !== "user" && !v.ctx.returns.has(t.id));
  const by = new Map<string, number>();
  for (const t of bad) by.set(`${t.counterparty} as ${t.category}`, (by.get(`${t.counterparty} as ${t.category}`) ?? 0) + 1);
  return [...by].map(([what, n]) => found("I3a.money-in", h, v, `${n} rows in, ${what}`));
}

/** I3b: a payment-app prefix does not make a business a person: the payee is a person with it exactly when it is one without it. */
function prefix(h: GeneratedHousehold, v: HouseholdView): Violation[] {
  const people = new Map<string, Set<boolean>>();
  for (const t of v.ctx.txs) {
    if (t.amountCents >= 0 || !t.counterparty) continue;
    (people.get(t.counterparty) ?? people.set(t.counterparty, new Set()).get(t.counterparty)!).add(t.category === "p2p");
  }
  const out: Violation[] = [];
  for (const [name, own] of people) {
    const bare = name.startsWith(PREFIX) ? people.get(name.slice(PREFIX.length)) : undefined;
    if (bare && [...own].some((p) => !bare.has(p))) out.push(found("I3b.prefix", h, v, `${name} is ${own.has(true) ? "a person" : "a payee"}, ${name.slice(PREFIX.length)} is ${bare.has(true) ? "a person" : "a payee"}`));
  }
  return out;
}

/** I3c: the payer of the wallet has no account, so the question never offers it as the member's own money. */
function walletRole(h: GeneratedHousehold, v: HouseholdView): Violation[] {
  const asked = buildQuestions(v.ctx, RANGE(h), { ...NO_INPUTS, payers: { memberId: viewName(v), roles: [] } }, [], Infinity);
  return asked.items
    .filter((i) => i.kind === "payer" && i.key === WALLET_PAYER_KEY && (i.options.includes("own_money") || i.proposal === "own_money"))
    .map(() => found("I3c.wallet-role", h, v, "the wallet payer is offered own_money"));
}

/** I4: the monthly sum of a loan in the household view is what its members' views add up to. */
function loanParts(h: GeneratedHousehold, views: readonly HouseholdView[]): Violation[] {
  const monthly = (v: HouseholdView) => new Map(loanProposals(v.ctx, NO_INPUTS).map((p) => [p.key, p.monthlyCents]));
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

/** Every violation of a household, in each view; `twin` is the same household with reference days, for I5. */
export function violationsOf(h: GeneratedHousehold, twin?: GeneratedHousehold): Violation[] {
  const views = viewsOf(h);
  return [...views.flatMap((v) => [...conservation(h, v), ...onePool(h, v), ...memberLegs(h, v), ...moneyIn(h, v), ...prefix(h, v), ...walletRole(h, v)]), ...loanParts(h, views), ...(twin ? unproven(h, twin) : [])];
}
