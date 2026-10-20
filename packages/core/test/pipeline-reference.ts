// The enrichment before the memo and the pauses: a copy kept as the oracle for the differential tests.
import { getCategory } from "../src/categories.ts";
import { categorize, compileRules } from "../src/categorize.ts";
import { businessMerchants, isBusinessRow } from "../src/industry.ts";
import { fold, UNKNOWN_MERCHANT } from "../src/merchant.ts";
import { matchReturns, partyKey, steadyParties } from "../src/returns.ts";
import { detectTransfers, normalizeIban } from "../src/transfers.ts";
import type { Account, CategoryRule, Transaction } from "../src/types.ts";
import { isCardIssuerText } from "../src/wording.ts";

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
export function enrichTransactionsReference(
  txs: readonly Transaction[],
  accounts: readonly Account[],
  userRules: readonly CategoryRule[],
  industries: ReadonlyMap<string, string> = new Map(),
): Transaction[] {
  const rules = compileRules(userRules);
  const byUserRule = new Set<string>();
  // the payees an account pays about the same sum in three or more months: the pipeline hands the rules the same yes or no
  const steady = steadyParties(txs.filter((t) => t.amountCents < 0 && t.merchant !== UNKNOWN_MERCHANT));
  const next = txs.map((t): Transaction => {
    if (t.categorySource === "user") return { ...t, isTransfer: t.category === "transfer" };
    const { category, source, byUser } = categorize(t.amountCents < 0 && steady.has(partyKey(t)) ? { ...t, steadyPayee: true } : t, rules, accounts);
    if (byUser) byUserRule.add(t.id);
    // a rule may say "this is a transfer" too (e.g. a user rule for "OMA SIIRTO")
    return { ...t, category, categorySource: source, isTransfer: category === "transfer" };
  });

  // before transfer detection: a card bill pairs with the connected card's payment row
  for (const t of cardBillsByAmount(next.filter((t) => !byUserRule.has(t.id)))) t.category = "card_bill";

  // money that comes back (refund, repaid person, shared bill) cancels its payment; both rows stay out of transfer pairing
  const ownIbans = new Set(accounts.map((a) => normalizeIban(a.iban)).filter((x): x is string => !!x));
  const returns = matchReturns(next, ownIbans, byUserRule);
  const transfers = detectTransfers(next, accounts, { exclude: new Set([...returns.keys(), ...returns.values()]) });
  for (const t of next) {
    if (t.categorySource !== "user" && transfers.has(t.id)) {
      t.category = "transfer";
      t.categorySource = "transfer";
      t.isTransfer = true;
    }
  }

  // after transfer detection, which treats unrecognised rows as possible own transfers
  const likeOthers = merchantCategories(next);
  const cards = new Set(accounts.filter((a) => a.type === "credit_card").map((a) => a.id));
  const shops = businessMerchants(next);
  for (const t of next) {
    if (t.categorySource !== "default" || t.amountCents >= 0) continue;
    const same = likeOthers.get(t.merchant);
    const industry = industries.get(t.merchant);
    // debt too: a collection agency's industry means debt service
    const kind = industry ? getCategory(industry).kind : null;
    if (same) Object.assign(t, { category: same, categorySource: "merchant" });
    // only on business rows: a person who shares a company's name stays a person
    else if (industry && (kind === "expense" || kind === "debt") && isBusinessRow(t, cards, shops)) Object.assign(t, { category: industry, categorySource: "industry" });
  }

  // last, so a refund takes the category the payment finally got (rule, card code, industry)
  const byId = new Map(next.map((t) => [t.id, t]));
  for (const [id, purchaseId] of returns) {
    const refund = byId.get(id)!;
    const purchase = byId.get(purchaseId)!;
    const kind = getCategory(purchase.category).kind;
    if (!purchase.isTransfer && (kind === "expense" || kind === "debt")) Object.assign(refund, { category: purchase.category, categorySource: "match", isTransfer: false });
  }

  return next.filter((t, i) => {
    const before = txs[i]!;
    return t.category !== before.category || t.categorySource !== before.categorySource || t.isTransfer !== before.isTransfer;
  });
}

// The card issuers are the pipeline's own list (wording.ts `isCardIssuerText`), as the rules are its own `categorize`: this
// copy is the oracle for the order of the steps, the memo and the pauses, and a second list of names would only drift.
/** Texts that name a loan: such a payment stays a loan whatever its amount. */
const LOAN_TEXT = /(?<![A-Z0-9])(?:OSAMAKSU[A-Z]*|LAINA[A-Z]*|LYHENNYS|LAINANHOITO|RAHOITUSSOPIMUS|SOPIMUS|KULUTUSLUOTTO)(?![A-Z0-9])/;

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
    if (!isCardIssuerText(text) || LOAN_TEXT.test(text)) continue;
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

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
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
