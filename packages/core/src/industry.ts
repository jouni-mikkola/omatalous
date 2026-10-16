/**
 * Category from a company's industry, for merchants no rule or card code
 * recognises. The server looks the merchant up in the Finnish trade
 * register (PRH / YTJ open data) and keeps the answer; this module only
 * decides, without I/O, which registry entry matches the merchant and what
 * its industry code (TOL) means for the household (the tables are in
 * industry-codes.ts).
 */
import { fold, isPlaceName, UNKNOWN_MERCHANT } from "./merchant.ts";
import { householdWords, mayBePerson, nameIn, payeeName, payeeText, TERMINAL_PREFIX } from "./payee-guard.ts";
import { companyForms, hasBusinessWord, hasPayeeForm, isBusinessPaymentText, isPaymentMethodName, isPersonShaped, MOBILEPAY_WORDS, namesBusiness, PERSON_PAYMENT_PREFIX } from "./wording.ts";
import { categoryForIndustry, type IndustryCodeSet } from "./industry-codes.ts";
import type { Account, Transaction } from "./types.ts";

export { householdWords, namesHousehold } from "./payee-guard.ts";

export * from "./industry-codes.ts";

// ── matching a merchant to a registry entry ──────────────

export interface RegistryCompany {
  businessId: string;
  /** Names in use now: the trade name, parallel names and auxiliary trade names. */
  names: string[];
  /** In the trade register's books (status 1), not ceased or being wound up. */
  active: boolean;
  industry: { code: string; codeSet: IndustryCodeSet; label: string | null } | null;
}

/** What the register's answer for a merchant leaves in the database: the industry of the company found and its name. */
export interface RegisterAnswer {
  code: string | null;
  codeSet: IndustryCodeSet | null;
  companyName: string | null;
}

export interface IndustryMatch {
  status: "found" | "none" | "ambiguous";
  businessId: string | null;
  companyName: string | null;
  code: string | null;
  codeSet: IndustryCodeSet | null;
  label: string | null;
  /** Null when the company was found but neither its industry nor its name says what it sells. */
  category: string | null;
}

const COMPANY_FORMS = companyForms("strip");

/** The name's letters and digits as words, accents and punctuation gone, company forms kept. */
function plainWords(name: string): string[] {
  return fold(name.normalize("NFD").replace(/\p{M}/gu, ""))
    .replace(/[^A-Z0-9&]+/g, " ")
    .trim()
    .split(" ");
}

/**
 * "Liikuntakeskus Fressi Oy" → "LIIKUNTAKESKUS FRESSI". Accents are stripped
 * first ("Café" → "CAFE", not "CAF") and every company form at either end
 * goes ("Oy Kahvila Ilo Ab", "Stockmann Oyj Abp").
 */
export function companyKey(name: string): string {
  const words = plainWords(name);
  let lo = 0;
  let hi = words.length;
  while (lo < hi && COMPANY_FORMS.has(words[lo]!)) lo++;
  while (hi > lo && COMPANY_FORMS.has(words[hi - 1]!)) hi--;
  return words.slice(lo, hi).join(" ");
}

/** How well a registry name fits the merchant, 0 for not at all; the merchant is `plain` as written and `query` without company forms. */
function score(query: string, plain: string, name: string): number {
  const key = companyKey(name);
  if (!key) return 0;
  if (plainWords(name).join(" ") === plain) return 4;
  if (key === query) return 3;
  if (key.startsWith(`${query} `)) return 2;
  return ` ${key} `.includes(` ${query} `) ? 1 : 0;
}

const NONE: IndustryMatch = { status: "none", businessId: null, companyName: null, code: null, codeSet: null, label: null, category: null };

interface MatchOptions {
  /** Only a name equal to the merchant, with or without a company form: for a shortened query or a page of a longer hit list. */
  exactOnly?: boolean;
  /** What a company's name says by a trade word of its own (core `categoryByTradeWord`), read when its industry is too broad or missing. */
  byName?: (name: string) => string | null;
}

/**
 * Picks the registry entry for a merchant name. The best fit decides, in this order: a name equal to the merchant, the
 * merchant with a company form ("Oy", "Oyj", "Ab"), a name that starts with the merchant as a whole word, one that holds
 * it as a whole word. A match inside a word is none. A company in the books wins over a ceased one at any fit (a ceased
 * one answers only when none is in the books, and not for a one-word merchant), and among the companies of the best fit
 * those whose industry gives a category win over those whose does not; the trade word in a name (`byName`) gives
 * one only when no industry does. If the rest point to different categories the answer is "ambiguous" and the merchant
 * stays uncategorised.
 */
export function matchCompany(merchant: string, companies: readonly RegistryCompany[], opts: MatchOptions = {}): IndustryMatch {
  const query = companyKey(merchant);
  if (query.length < 3) return NONE;
  const plain = plainWords(merchant).join(" ");
  const hits: { company: RegistryCompany; name: string; tier: number }[] = [];
  for (const company of companies) {
    let tier = 0;
    let name = "";
    for (const n of company.names) {
      const sc = score(query, plain, n);
      if (sc > tier) [tier, name] = [sc, n];
    }
    if (tier > 0) hits.push({ company, name, tier });
  }
  const bestOf = (list: typeof hits) => {
    const best = Math.max(0, ...list.map((h) => h.tier));
    return { best, group: list.filter((h) => h.tier === best) };
  };
  const all = bestOf(hits);
  if (!hits.length || (opts.exactOnly && all.best < 3)) return NONE;
  // a loose match against many companies is a common word, not this merchant: counted with the ceased ones too
  if (all.best < 3 && all.group.length > 3) return { ...NONE, status: "ambiguous" };
  // a company in the books beats a ceased one whatever its fit; ceased ones answer only when none is in the books
  const live = hits.filter((h) => h.company.active);
  const { best, group } = bestOf(live.length ? live : hits);
  if (opts.exactOnly && best < 3) return NONE;
  if (best < 3 && group.length > 3) return { ...NONE, status: "ambiguous" };
  // one word that only a ceased company bears is as likely a namesake as the merchant
  if (!live.length && !query.includes(" ")) return { ...NONE, status: "ambiguous" };

  const withCode = group.map((g) => ({ ...g, category: g.company.industry ? categoryForIndustry(g.company.industry.code, g.company.industry.codeSet) : null }));
  const coded = withCode.filter((g) => g.category !== null);
  const candidates = coded.length ? coded : withCode.map((g) => ({ ...g, category: opts.byName?.(g.name) ?? null })).filter((g) => g.category !== null);
  // a dealer and a garage of one name are both the car's: the garage is picked, so the rows stay the car's upkeep
  const upkeep = (c: string | null) => (c === "vehicle_purchase" ? "car" : c);
  if (new Set(candidates.map((g) => upkeep(g.category))).size > 1) return { ...NONE, status: "ambiguous" };
  if (!candidates.length && group.length > 1) return { ...NONE, status: "ambiguous" };
  const pick = candidates.find((g) => g.category === "car") ?? candidates[0] ?? withCode[0]!;
  const industry = pick.company.industry;
  return {
    status: "found",
    businessId: pick.company.businessId,
    companyName: pick.name,
    code: industry?.code ?? null,
    codeSet: industry?.codeSet ?? null,
    label: industry?.label ?? null,
    category: pick.category,
  };
}

/**
 * The merchant with a company form for a second question to the register, when the plain one drowns the company in
 * namesakes ("Ayvens" → "Ayvens Oy"). Null when the name has a form already or is no name to ask about.
 */
export function formQuery(merchant: string): string | null {
  const withForm = `${merchant.trim()} Oy`;
  return plainWords(merchant).join(" ") !== companyKey(merchant) || !isLookupName(merchant) || !isLookupName(withForm) ? null : withForm;
}

/**
 * The name without its last word, for branch names like "Kukkakauppa Ilo
 * Kallio". At least two words besides company forms stay, so it never
 * shrinks to a trade word ("Hammaslääkäri"). The one exception is a town
 * or district after a single word ("Lankapuoti Tikkurila Oy" →
 * "Lankapuoti"). Match it with `exactOnly`.
 *
 * It is never a person's name or a part of one. A company named after a
 * person is asked about whole or not at all: "Matti Virtanen Oy" is not
 * asked about as "Matti Virtanen", nor "Matti Kivistö Oy" as "Matti", where
 * the surname is a town too. So a name that is person-shaped without its
 * company forms has no shorter query ("Fysiopiste Tikkurila Oy" neither:
 * the shape cannot tell it from a first name and a surname), and what is
 * returned passes `isLookupName` like the name itself.
 */
export function shorterQuery(merchant: string): string | null {
  const words = merchant.trim().split(/\s+/);
  const core = words.filter((w) => companyKey(w) !== "");
  if (isPersonShaped(fold(core.join(" ")))) return null;
  const afterTown = core.length === 2 && isPlaceName(core[1]!) && companyKey(core[0]!).length >= 3;
  const shorter = afterTown ? core[0]! : words.slice(0, -1).join(" ");
  if (!afterTown && (words.length < 3 || companyKey(shorter).split(" ").length < 2)) return null;
  return isLookupName(shorter) ? shorter : null;
}

// ── which merchants to look up ───────────────────────────

type BusinessRowFields = Pick<Transaction, "mcc" | "accountId" | "counterparty" | "counterpartyIban" | "description"> & {
  merchant?: string;
  /** The payment's reference number. A row built without the field says nothing either way, and is no invoice. */
  reference?: string | null;
};

const MOBILEPAY = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${MOBILEPAY_WORDS}|SIIRTO HENKILO(?:LLE|LTA))(?![\p{L}\p{N}])`, "u");

/** A MobilePay or Pivo payment: no payee account, but often a person. */
export function isMobilePay(t: Pick<Transaction, "counterparty" | "description">): boolean {
  return MOBILEPAY.test(fold([t.counterparty, t.description].filter(Boolean).join(" ")));
}

/** One account's rows from one source: the unit in which a payee account is or is not delivered. */
export const ledgerOf = (t: Pick<Transaction, "accountId" | "source">): string => `${t.accountId}\u0000${t.source ?? ""}`;

/**
 * The ledgers whose outgoing transfers carry payee accounts. Only there does a missing payee account tell a card
 * purchase from a transfer: a CSV layout without IBANs leaves every payee, a person too, without one. A bank fetch
 * into the same account says nothing about CSV rows imported before it, so the source is part of the ledger.
 */
export function ledgersWithPayeeAccounts(txs: readonly Pick<Transaction, "accountId" | "source" | "amountCents" | "counterpartyIban">[]): Set<string> {
  const ledgers = new Set<string>();
  for (const t of txs) if (t.amountCents < 0 && t.counterpartyIban) ledgers.add(ledgerOf(t));
  return ledgers;
}

/** The text a bank leaves when it gives the shop's name apart: the terminal's number and its town ("483920 HELSINKI"). */
const TERMINAL_TEXT = /^\d{4,}(?:\s+\d+)*\s+(\p{L}+(?:\s+\p{L}+)?)$/u;

/** The shape a card terminal gives a row, on any account. */
export function hasTerminalShape(t: Pick<Transaction, "counterparty" | "description">): boolean {
  if (TERMINAL_PREFIX.test(payeeText(t))) return true;
  // beside a payee's name only: the text of a row that names no payee is the name itself
  const town = t.counterparty?.trim() && t.description ? TERMINAL_TEXT.exec(t.description.trim())?.[1] : undefined;
  return !!town && (isPlaceName(town) || town.split(/\s+/).every(isPlaceName));
}

const WALLET_PREFIX = new RegExp(String.raw`^\s*(?:${PERSON_PAYMENT_PREFIX})\s*\*`, "i");

/**
 * A payment to a bare name through MobilePay or PayPal, which carry money to people too. The name is most often a
 * person's, also when the bank books the payment as a card purchase ("MOB.PAY*MATTI JUHANI MEIKAL" on a card
 * account) and when it is one word ("PAYPAL *MATTIMEIKALAINEN"). Only a company form or a business word in the name
 * says otherwise.
 */
function paysBareNameByWallet(t: Pick<Transaction, "counterparty" | "description">, mobilePay: boolean): boolean {
  if (!mobilePay && !WALLET_PREFIX.test(t.counterparty ?? "") && !WALLET_PREFIX.test(t.description ?? "")) return false;
  const name = payeeName(t);
  return !hasPayeeForm(name) && !hasBusinessWord(name);
}

/** A Finnish reference number or an international RF reference. */
const REFERENCE_NUMBER = /^(?:RF\d{2}[A-Z0-9]{1,21}|\d{4,20})$/;

const NO_NAMES: ReadonlySet<string> = new Set();

/**
 * An invoice from a business: a payment to an account with a reference number, to a payee the guard takes for no
 * person (mayBePerson). The reference alone proves nothing: a private landlord gives one too, and the payer typed
 * the payee's name. A row with no payee field is none: its name is the payer's own message. A payee whose name says
 * it is a business and names no person beside that (wording `namesBusiness`) was an invoice's before the guard and
 * stays one. `evidenced`: another row of the merchant has business evidence of another kind.
 */
function isInvoice(t: BusinessRowFields, evidenced: boolean): boolean {
  if (!t.counterpartyIban || !t.reference || !REFERENCE_NUMBER.test(t.reference.replace(/\s+/g, "").toUpperCase())) return false;
  const payee = nameIn(t.counterparty);
  return /\p{L}/u.test(payee) && (namesBusiness(payee) || !mayBePerson(t, NO_NAMES, evidenced));
}

/**
 * Merchants that a row shows to be a shop by its own evidence and that were paid at least twice without a payee
 * account and not with MobilePay. Their rows without card text are card purchases too: a CSV export carries none.
 * Two payments without a payee account prove nothing by themselves, because some banks deliver a transfer to a
 * person that way. Only rows of a ledger whose other outgoing transfers carry a payee account are counted:
 * `payeeLedgers` says which (ledgersWithPayeeAccounts) when `txs` is a selection of the rows.
 */
export function businessMerchants(
  txs: readonly (BusinessRowFields & Pick<Transaction, "accountId" | "source" | "amountCents" | "merchant">)[],
  payeeLedgers: ReadonlySet<string> = ledgersWithPayeeAccounts(txs),
): Set<string> {
  const counts = new Map<string, number>();
  const shown = new Set<string>();
  for (const t of txs) {
    if (t.amountCents >= 0 || t.counterpartyIban || t.merchant === UNKNOWN_MERCHANT || isMobilePay(t)) continue;
    // a row with no payee account is no invoice, so this is all the evidence it can have
    if (!shown.has(t.merchant) && isPaidAsBusiness(t, NO_NAMES, NO_NAMES, false)) shown.add(t.merchant);
    if (payeeLedgers.has(ledgerOf(t))) counts.set(t.merchant, (counts.get(t.merchant) ?? 0) + 1);
  }
  return new Set([...shown].filter((merchant) => (counts.get(merchant) ?? 0) >= 2));
}

/**
 * Whether a row of spending pays a business: the register's answer for its merchant may be used on it, and the
 * merchant's name may be asked about when the guard takes it for no person's (industryCandidates). Positive evidence only:
 *   - a card paid: no payee account, and a merchant code, a card account or the text a card terminal leaves,
 *     or a merchant in `shops` (businessMerchants)
 *   - the payee's name has a company form (Oy, Ab, ry…)
 *   - the bank's text says card purchase, e-invoice or direct payment
 *   - an invoice: a payee account, a reference number and a payee field the guard takes for no person (isInvoice).
 *     Here a merchant in `shops` is what vouches for a payee whose name does not say business itself: one bare
 *     word, or a sign in a word
 * A plain transfer is never enough, and neither is a missing payee account. A MobilePay or PayPal payment to a bare
 * name pays a person, whatever else the row says.
 */
export function isBusinessRow(t: BusinessRowFields, cards: ReadonlySet<string>, shops: ReadonlySet<string> = NO_NAMES): boolean {
  return hasBusinessEvidence(t, cards, shops, isMobilePay(t), shops);
}

/** Business evidence of a row other than an invoice. */
function isPaidAsBusiness(t: BusinessRowFields, cards: ReadonlySet<string>, shops: ReadonlySet<string>, mobilePay: boolean): boolean {
  if (paysBareNameByWallet(t, mobilePay)) return false;
  // a payee account means a transfer, also from a card account (credit moved to a person)
  if (!t.counterpartyIban && (t.mcc || cards.has(t.accountId) || hasTerminalShape(t))) return true;
  if (!t.counterpartyIban && t.merchant !== undefined && shops.has(t.merchant) && !mobilePay) return true;
  // in the bank's own text, where a name's letters are whole: the payee field, else the text that names the payee
  if (hasPayeeForm(fold(payeeText(t)))) return true;
  return !!t.description && isBusinessPaymentText(fold(t.description));
}

/** `evidenced`: the merchants with a row that isPaidAsBusiness, as far as the caller knows them. */
function hasBusinessEvidence(t: BusinessRowFields, cards: ReadonlySet<string>, shops: ReadonlySet<string>, mobilePay: boolean, evidenced: ReadonlySet<string>): boolean {
  if (isPaidAsBusiness(t, cards, shops, mobilePay)) return true;
  return !paysBareNameByWallet(t, mobilePay) && isInvoice(t, t.merchant !== undefined && evidenced.has(t.merchant));
}

/**
 * A name that may go to the register: some letters, not a placeholder, not the name of a way to pay ("Siirto") and
 * not shaped like a person's name (wording `isPersonShaped`). The register is public and outside the household: a
 * person's name never goes there. Every string the server sends passes this, the shorter query too (shorterQuery).
 */
export function isLookupName(merchant: string): boolean {
  if (merchant === UNKNOWN_MERCHANT || merchant.length > 60 || companyKey(merchant).replace(/[^A-Z]/g, "").length < 3) return false;
  const folded = fold(merchant);
  return !isPaymentMethodName(folded) && !isPersonShaped(folded);
}

/**
 * Merchants with spending that nothing else categorised, largest total
 * first, limited to those that are clearly businesses: every such row of
 * the merchant is a business row (isBusinessRow), and the guard takes none
 * for a person's (mayBePerson), whatever made the row a business row.
 *
 * The household's names are the holders of `accounts` and the words in
 * `household` (householdWords): the members' display names, the holders of
 * another member's accounts.
 */
export function industryCandidates(
  txs: readonly (BusinessRowFields & Pick<Transaction, "amountCents" | "isTransfer" | "categorySource" | "merchant">)[],
  accounts: readonly Pick<Account, "id" | "type" | "holder">[],
  household: ReadonlySet<string> = NO_NAMES,
): string[] {
  const cards = new Set(accounts.filter((a) => a.type === "credit_card").map((a) => a.id));
  const names = new Set([...household, ...householdWords(accounts.map((a) => a.holder))]);
  const totals = new Map<string, number>();
  const ruledOut = new Set<string>();
  const uncategorised = txs.filter((t) => t.amountCents < 0 && !t.isTransfer && t.categorySource === "default" && isLookupName(t.merchant));
  const shops = businessMerchants(uncategorised, ledgersWithPayeeAccounts(txs));
  // what vouches for an invoice's payee whose name does not say business: a row of the same merchant that a card paid, or the like
  const evidenced = new Set(uncategorised.filter((t) => isPaidAsBusiness(t, cards, shops, isMobilePay(t))).map((t) => t.merchant));
  for (const t of uncategorised) {
    // one row that is a transfer, or whose payee may be a person, rules the merchant out
    if (!hasBusinessEvidence(t, cards, shops, isMobilePay(t), evidenced) || mayBePerson(t, names, evidenced.has(t.merchant))) {
      ruledOut.add(t.merchant);
      continue;
    }
    totals.set(t.merchant, (totals.get(t.merchant) ?? 0) - t.amountCents);
  }
  return [...totals.entries()]
    .filter(([merchant]) => !ruledOut.has(merchant))
    .sort((a, b) => b[1] - a[1])
    .map(([merchant]) => merchant);
}
