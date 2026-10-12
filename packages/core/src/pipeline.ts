import { getCategory } from "./categories.ts";
import { categorize, compileRules } from "./categorize.ts";
import { businessMerchants, isBusinessRow, ledgerOf, ledgersWithPayeeAccounts } from "./industry.ts";
import { fold, UNKNOWN_MERCHANT } from "./merchant.ts";
import { dayNumber } from "./dates.ts";
import { median } from "./stats.ts";
import { matchReturns, returnClassOf, SHARE_WINDOW_DAYS } from "./returns.ts";
import { detectTransfers, normalizeIban, pairable as canPairAsTransfer } from "./transfers.ts";
import type { Account, CategoryRule, Transaction } from "./types.ts";
import { isCardIssuerText, isLoanText } from "./wording.ts";

/**
 * Re-derives category and transfer flags for every transaction. Categories
 * the user set by hand are never touched. Returns only the transactions
 * whose enrichment changed, so callers write as little as possible.
 *
 * Order of evidence: the user's rules, built-in rules, the card's merchant
 * code (MCC), the same merchant's other purchases, and last the merchant's
 * industry from the trade register (`industries`: merchant → category).
 * Money that comes back (see matchReturns) takes its payment's category.
 */
export function enrichTransactions(
  txs: readonly Transaction[],
  accounts: readonly Account[],
  userRules: readonly CategoryRule[],
  industries: ReadonlyMap<string, string> = new Map(),
): Transaction[] {
  const steps = enrichSteps(txs, accounts, userRules, industries);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/**
 * The same enrichment for a caller that must not hold the event loop for the whole run: `pause` is awaited between
 * the stages and every few thousand rows inside them. Core stays free of timers, the caller says how to give way.
 */
export async function enrichTransactionsPausing(
  txs: readonly Transaction[],
  accounts: readonly Account[],
  userRules: readonly CategoryRule[],
  industries: ReadonlyMap<string, string>,
  pause: () => Promise<void>,
): Promise<Transaction[]> {
  const steps = enrichSteps(txs, accounts, userRules, industries);
  let step = steps.next();
  while (!step.done) {
    await pause();
    step = steps.next();
  }
  return step.value;
}

/** Rows between two pauses. A stage over this many rows takes tens of milliseconds. */
const CHUNK = 4000;

/**
 * What a rule says depends on the row's names, its card code, the bank's own transaction code and the direction of
 * the money only, and a long history repeats the same shop, text and codes thousands of times: each distinct
 * combination is decided once.
 */
function* classify(txs: readonly Transaction[], userRules: readonly CategoryRule[]): Generator<void, { next: Transaction[]; byUserRule: Set<string> }, void> {
  const rules = compileRules(userRules);
  const byUserRule = new Set<string>();
  const decided = new Map<string, ReturnType<typeof categorize>>();
  const next: Transaction[] = new Array(txs.length);
  for (let i = 0; i < txs.length; i++) {
    if (i % CHUNK === CHUNK - 1) yield;
    const t = txs[i]!;
    if (t.categorySource === "user") {
      next[i] = { ...t, isTransfer: t.category === "transfer" };
      continue;
    }
    const key = `${t.amountCents >= 0 ? "+" : "-"}\u0000${t.merchant}\u0000${t.counterparty ?? "\u0001"}\u0000${t.description ?? "\u0001"}\u0000${t.mcc ?? "\u0001"}\u0000${t.bankTxnCode ?? "\u0001"}`;
    let result = decided.get(key);
    if (!result) decided.set(key, (result = categorize(t, rules)));
    const { category, source, byUser } = result;
    if (byUser) byUserRule.add(t.id);
    // a rule may say "this is a transfer" too (e.g. a user rule for "OMA SIIRTO")
    next[i] = { ...t, category, categorySource: source, isTransfer: category === "transfer" };
  }
  return { next, byUserRule };
}

/** Before transfer detection: a card bill pairs with the connected card's payment row. */
function applyCardBills(next: readonly Transaction[], byUserRule: ReadonlySet<string>): void {
  for (const t of cardBillsByAmount(next.filter((t) => !byUserRule.has(t.id)))) t.category = "card_bill";
}

/** Rows nothing recognised take their merchant's other purchases' category, or the merchant's industry. After transfer detection, which treats such rows as possible own transfers. */
function* applyMerchantEvidence(
  next: readonly Transaction[],
  accounts: readonly Account[],
  industries: ReadonlyMap<string, string>,
  payeeLedgers: ReadonlySet<string> = ledgersWithPayeeAccounts(next),
): Generator<void, void, void> {
  const likeOthers = merchantCategories(next);
  const cards = new Set(accounts.filter((a) => a.type === "credit_card").map((a) => a.id));
  const shops = businessMerchants(next, payeeLedgers);
  for (let i = 0; i < next.length; i++) {
    if (i % CHUNK === CHUNK - 1) yield;
    const t = next[i]!;
    if (t.categorySource !== "default" || t.amountCents >= 0) continue;
    const same = likeOthers.get(t.merchant);
    const industry = industries.get(t.merchant);
    // debt too: a collection agency's industry means debt service
    const kind = industry ? getCategory(industry).kind : null;
    if (same) Object.assign(t, { category: same, categorySource: "merchant" });
    // only on business rows: a person who shares a company's name stays a person
    else if (industry && (kind === "expense" || kind === "debt") && isBusinessRow(t, cards, shops)) Object.assign(t, { category: industry, categorySource: "industry" });
  }
}

/** Last, so a refund takes the category the payment finally got (rule, card code, industry). */
function applyReturns(next: readonly Transaction[], returns: ReadonlyMap<string, string>): void {
  const byId = new Map(next.map((t) => [t.id, t]));
  for (const [id, purchaseId] of returns) {
    const refund = byId.get(id)!;
    const purchase = byId.get(purchaseId)!;
    const kind = getCategory(purchase.category).kind;
    if (!purchase.isTransfer && (kind === "expense" || kind === "debt")) Object.assign(refund, { category: purchase.category, categorySource: "match", isTransfer: false });
  }
}

const ownIbansOf = (accounts: readonly Account[]) => new Set(accounts.map((a) => normalizeIban(a.iban)).filter((x): x is string => !!x));

const changedRows = (next: readonly Transaction[], txs: readonly Transaction[]) =>
  next.filter((t, i) => {
    const before = txs[i]!;
    return t.category !== before.category || t.categorySource !== before.categorySource || t.isTransfer !== before.isTransfer;
  });

function* enrichSteps(
  txs: readonly Transaction[],
  accounts: readonly Account[],
  userRules: readonly CategoryRule[],
  industries: ReadonlyMap<string, string>,
): Generator<void, Transaction[], void> {
  const { next, byUserRule } = yield* classify(txs, userRules);
  yield;
  applyCardBills(next, byUserRule);
  yield;

  // money that comes back (refund, repaid person, shared bill) cancels its payment; both rows stay out of transfer pairing
  const returns = matchReturns(next, ownIbansOf(accounts), byUserRule);
  yield;
  const transfers = detectTransfers(next, accounts, { exclude: new Set([...returns.keys(), ...returns.values()]) });
  for (const t of next) {
    if (t.categorySource !== "user" && transfers.has(t.id)) {
      t.category = "transfer";
      t.categorySource = "transfer";
      t.isTransfer = true;
    }
  }
  yield;

  yield* applyMerchantEvidence(next, accounts, industries);
  applyReturns(next, returns);
  return changedRows(next, txs);
}

// ── one merchant's rows ──────────────────────────────────

export interface IslandInput {
  /**
   * Every row of the merchants concerned (and no others), as stored after the change, in the order the full run
   * gets them: date, then id.
   */
  rows: readonly Transaction[];
  /** What rows the change touched were before it (a category the user had set); other rows were as stored. */
  before: ReadonlyMap<string, Pick<Transaction, "category" | "categorySource">>;
  accounts: readonly Account[];
  rules: readonly CategoryRule[];
  /** The user's rules before the change. */
  oldRules: readonly CategoryRule[];
  industries: ReadonlyMap<string, string>;
  /** Rows outside the island that returns matched (stored source "match"): a friend's share carries its purchase's category. */
  outsideMatches: readonly Pick<Transaction, "accountId" | "bookingDate" | "amountCents">[];
}

export type IslandResult = { ok: true; changed: Transaction[] } | { ok: false; reason: string };

/**
 * The enrichment after a single change (one category set by hand, one merchant rule) for the rows of the merchants
 * concerned, without reading the rest of the history. The result is what `enrichTransactions` over the whole
 * history would give for those rows, and nothing outside them changes. Every cross-row stage is checked and the
 * answer is `ok: false` when one of them might reach beyond the island, so the caller runs the full enrichment:
 *
 * - votes, card bills, industry and refunds of one merchant stay inside its rows;
 * - transfer pairing is unchanged when no row of the island pairs (none was paired) and each row either keeps its
 *   part in it or leaves it for good (a row that was never paired leaving the candidates changes nobody's pairing);
 * - returns are unchanged when each row keeps its part, and a friend's share outside the island that follows an
 *   island purchase is looked for;
 * - the old inputs run through the same steps must give the stored rows back, which also catches a stored state that
 *   an earlier version derived differently.
 */
export function enrichIsland(input: IslandInput): IslandResult {
  const { rows, accounts, industries } = input;
  if (rows.some((t) => t.categorySource === "transfer")) return { ok: false, reason: "a row of the merchant is paired as a transfer" };
  const ownIbans = ownIbansOf(accounts);
  const run = (txs: readonly Transaction[], userRules: readonly CategoryRule[]) => {
    const steps = classify(txs, userRules);
    let step = steps.next();
    while (!step.done) step = steps.next();
    const { next, byUserRule } = step.value;
    applyCardBills(next, byUserRule);
    return { next, byUserRule, returns: matchReturns(next, ownIbans, byUserRule) };
  };
  const finishWith = (staged: ReturnType<typeof run>, payeeLedgers: ReadonlySet<string>) => {
    // no row of the island pairs: the transfer stage adds nothing to it
    const next = staged.next.map((t) => ({ ...t }));
    const evidence = applyMerchantEvidence(next, accounts, industries, payeeLedgers);
    while (!evidence.next().done);
    applyReturns(next, staged.returns);
    return next;
  };
  // Whether a ledger (an account's rows of one source) carries payee accounts is known from the island's rows as far
  // as they show one; rows outside may show one too. The industry shops depend on it, so the answer must be the same
  // with and without them.
  const seen = ledgersWithPayeeAccounts(rows);
  const possible = new Set(rows.map(ledgerOf));
  const finish = (staged: ReturnType<typeof run>) => {
    const low = finishWith(staged, seen);
    if (seen.size === possible.size) return low;
    const high = finishWith(staged, possible);
    return low.every((t, i) => t.category === high[i]!.category && t.categorySource === high[i]!.categorySource && t.isTransfer === high[i]!.isTransfer) ? low : null;
  };

  const was = rows.map((t) => ({ ...t, ...input.before.get(t.id) }));
  const old = run(was, input.oldRules);
  // the old inputs must reproduce what is stored, or the stored state is not what a full run left
  const oldFinal = finish(old);
  if (!oldFinal) return { ok: false, reason: "industry shops depend on payee accounts outside the merchant" };
  for (let i = 0; i < rows.length; i++) {
    const stored = was[i]!;
    const f = oldFinal[i]!;
    if (f.category !== stored.category || f.categorySource !== stored.categorySource || f.isTransfer !== stored.isTransfer) {
      return { ok: false, reason: "the stored rows are not what the old rules give" };
    }
  }

  const now = run(rows, input.rules);
  for (let i = 0; i < rows.length; i++) {
    const o = old.next[i]!;
    const n = now.next[i]!;
    // pairing: the same part in it, or no part any more
    const oldKey = transferKey(o);
    const newKey = transferKey(n);
    if (oldKey !== newKey && newKey !== INERT) return { ok: false, reason: "a row may take part in transfer pairing" };
    const oldReturn = returnKey(o, ownIbans, old.byUserRule.has(o.id));
    const newReturn = returnKey(n, ownIbans, now.byUserRule.has(n.id));
    if (oldReturn === "share" || newReturn === "share") return { ok: false, reason: "a row may be a friend's share of a bill" };
    if (oldReturn !== newReturn) {
      // an incoming row that matched nothing can leave the candidates; anything else changes who is matched
      const leaves = o.amountCents >= 0 && oldReturn === "plain" && newReturn === "none" && !old.returns.has(o.id);
      if (!leaves) return { ok: false, reason: "a row's part in returns changed" };
    }
  }
  // the pairs found in the island are the pairs of the full run
  if (old.returns.size !== now.returns.size || [...old.returns].some(([k, v]) => now.returns.get(k) !== v)) return { ok: false, reason: "returns match differently" };
  // a purchase in the island must not have a matched row outside it: a friend's share carries its category
  const next = finish(now);
  if (!next) return { ok: false, reason: "industry shops depend on payee accounts outside the merchant" };
  const changed = changedRows(next, rows);
  if (input.outsideMatches.length) {
    for (const [i, t] of next.entries()) {
      // a purchase whose category differs from the one the share outside took from it
      if (t.amountCents >= 0 || t.category === oldFinal[i]!.category) continue;
      const day = dayNumber(t.bookingDate);
      for (const m of input.outsideMatches) {
        const gap = dayNumber(m.bookingDate) - day;
        if (m.accountId !== t.accountId || gap < 0 || gap > SHARE_WINDOW_DAYS) continue;
        // a share is one part of the bill: the whole bill is one to eight times its amount (see matchReturns)
        const total = -t.amountCents;
        const parts = Math.round(total / m.amountCents);
        if (parts === 1 ? total === m.amountCents : parts >= 2 && parts <= 8 && Math.abs(total - parts * m.amountCents) < parts) {
          return { ok: false, reason: "a share outside the merchant follows one of its purchases" };
        }
      }
    }
  }
  return { ok: true, changed };
}

/** A row that takes no part in pairing: the user's own choice, or neither a leg nor a card bill. */
const INERT = "inert";
const transferKey = (t: Transaction): string => {
  if (t.categorySource === "user") return INERT;
  const pairs = canPairAsTransfer(t);
  return !pairs && t.category !== "card_bill" ? INERT : `${pairs ? "leg" : ""}${t.category === "card_bill" ? "bill" : ""}`;
};

/** What returns look at in a row's state (the rest of what they read is in the bank's fields, which a change does not touch). */
const returnKey = (t: Transaction, ownIbans: ReadonlySet<string>, locked: boolean) => returnClassOf(t, ownIbans, locked);


/**
 * Payments to a card issuer that a rule called "loans" but whose amounts
 * jump from month to month: a card bill, not an instalment. An amount paid
 * three times or more is an instalment and stays a loan, so a car loan and a
 * card bill from the same issuer are told apart.
 */
function cardBillsByAmount(txs: readonly Transaction[]): Transaction[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (t.category !== "loans" || t.categorySource !== "rule" || t.amountCents >= 0) continue;
    const text = fold([t.merchant, t.counterparty, t.description].filter(Boolean).join(" | "));
    if (!isCardIssuerText(text) || isLoanText(text)) continue;
    const key = `${t.accountId}|${t.merchant}`;
    const group = groups.get(key);
    if (group) group.push(t);
    else groups.set(key, [t]);
  }
  const bills: Transaction[] = [];
  for (const rows of groups.values()) {
    const counts = new Map<number, number>();
    for (const t of rows) counts.set(t.amountCents, (counts.get(t.amountCents) ?? 0) + 1);
    const varying = rows.filter((t) => counts.get(t.amountCents)! < 3).sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));
    if (varying.length < 3) continue;
    // month-to-month change, not the overall range: a slowly shrinking instalment is not a card bill
    const changes = varying.slice(1).map((t, i) => Math.abs(t.amountCents - varying[i]!.amountCents) / Math.abs(varying[i]!.amountCents));
    if (median(changes) > 0.1) bills.push(...varying);
  }
  return bills;
}

/** Categories whose rows say nothing about what a merchant sells. */
const NO_VOTE = new Set(["p2p", "p2p_in", "card_bill", "cash", "fees"]);

/**
 * The category most of a merchant's purchases got from a rule or a card
 * code, for its rows that nothing recognised (e.g. the same shop without an
 * MCC). Hand-set rows do not count: "apply to this merchant" is a rule.
 * Payments to people, card bills, cash and fees do not vote: a café paid
 * once with MobilePay is still a café.
 */
function merchantCategories(txs: readonly Transaction[]): Map<string, string> {
  const votes = new Map<string, Map<string, number>>();
  for (const t of txs) {
    if (t.amountCents >= 0 || (t.categorySource !== "rule" && t.categorySource !== "mcc") || t.merchant === UNKNOWN_MERCHANT) continue;
    if (getCategory(t.category).kind !== "expense" || NO_VOTE.has(t.category)) continue;
    const m = votes.get(t.merchant) ?? new Map<string, number>();
    m.set(t.category, (m.get(t.category) ?? 0) + 1);
    votes.set(t.merchant, m);
  }
  const out = new Map<string, string>();
  for (const [merchant, m] of votes) {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const [category, count] = [...m.entries()].sort((a, b) => b[1] - a[1])[0]!;
    if (count / total >= 0.6) out.set(merchant, category);
  }
  return out;
}
