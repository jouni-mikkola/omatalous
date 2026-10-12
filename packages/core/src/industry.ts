/**
 * Category from a company's industry, for merchants no rule or card code
 * recognises. The server looks the merchant up in the Finnish trade
 * register (PRH / YTJ open data) and keeps the answer; this module only
 * decides, without I/O, which registry entry matches the merchant and what
 * its industry code (TOL) means for the household.
 *
 * The register uses two code sets while companies move over: TOL 2008
 * ("TOIMI3") and TOL 2025 ("TOIMI4", based on NACE Rev. 2.1). Most
 * prefixes mean the same in both; where they differ there is a table per set.
 */
import { cleanDescription, fold, isPlaceName, UNKNOWN_MERCHANT } from "./merchant.ts";
import { companyForms, dropUnseen, hasBusinessWord, hasPayeeForm, isBusinessPaymentText, isPaymentMethodName, isPersonShaped, MOBILEPAY_WORDS, namesBusiness, PERSON_PAYMENT_PREFIX } from "./wording.ts";
import type { Account, Transaction } from "./types.ts";

export type IndustryCodeSet = "TOL2008" | "TOL2025";

/** A code set the register answers in and this file has a table for; a stored one is checked before use. */
export const isIndustryCodeSet = (v: unknown): v is IndustryCodeSet => v === "TOL2008" || v === "TOL2025";

/** Prefix → category. `null` stops the search: the industry is too broad to say (wholesale, finance). */
type PrefixTable = Readonly<Record<string, string | null>>;

const COMMON: PrefixTable = {
  "1071": "groceries", // bakeries
  "35": "utilities",
  "36": "utilities",
  "37": "utilities",
  "38": "utilities",
  "41": "home",
  "42": null,
  "43": "home",
  "46": null,
  "4711": "groceries",
  "4719": "shopping", // TOL 2008 department stores
  "4712": "shopping", // TOL 2025 department stores
  "472": "groceries",
  "4725": "alcohol",
  "4726": "shopping",
  "473": "car",
  "474": "home",
  "475": "home",
  "476": "shopping",
  "477": "shopping",
  "4773": "health",
  "4774": "health",
  "4775": "personal_care",
  "4776": "home",
  "479": "shopping",
  "491": "transport",
  "493": "transport",
  "4934": "entertainment", // TOL 2025 ski lifts
  "4942": "home", // removals
  "50": "travel",
  "51": "travel",
  "5221": "car", // parking, roads
  "5223": "travel",
  "5232": "transport", // TOL 2025 ride booking
  "55": "travel",
  "56": "restaurants",
  "564": "food_delivery", // TOL 2025 delivery platforms
  "5811": "shopping",
  "581": "subscriptions",
  "5821": "entertainment",
  "5829": "subscriptions",
  "59": "entertainment",
  "60": "subscriptions",
  "61": "telecom",
  "62": "subscriptions",
  "63": "subscriptions",
  "64": null,
  "6419": "loans", // banks; not on a card purchase (categorize-bank-rows.ts)
  "6492": "loans", // other credit granting
  "65": "insurance",
  "66": null,
  "68": "housing",
  "75": "pets",
  "7711": "travel",
  "7751": "travel",
  "7721": "entertainment",
  "79": "travel",
  "80": "home",
  "81": "home",
  "8291": "collection",
  "84": "taxes",
  "85": "education",
  "8510": "kids",
  "8551": "fitness",
  "86": "health",
  "87": "health",
  "88": "health",
  "8891": "kids",
  "90": "entertainment",
  "91": "entertainment",
  "92": "gambling",
  "931": "fitness",
  "932": "entertainment",
  "941": "memberships",
  "942": "memberships",
  "9491": "gifts_donations",
  "9492": "gifts_donations",
  "9499": "memberships",
  "951": "home",
  "952": "home",
  "9601": "home", // TOL 2008 laundry
  "9602": "personal_care",
  "9604": "personal_care",
  "961": "home", // TOL 2025 laundry
  "962": "personal_care",
  "9691": "home",
};

const ONLY: Readonly<Record<IndustryCodeSet, PrefixTable>> = {
  TOL2008: {
    "45": "car",
    "4765": "kids", // toys
    "47764": "pets",
    "47783": "health", // opticians
    "47784": "kids", // prams and baby goods
    "478": "shopping", // market stalls
    "4781": "groceries",
  },
  TOL2025: {
    "4764": "kids", // toys
    "47763": "pets",
    "478": "car", // vehicle and parts retail
    "953": "car", // vehicle repair
  },
};

/** What a TOL code says about spending at the company, or null when it says nothing useful. */
export function categoryForIndustry(code: string, codeSet: IndustryCodeSet): string | null {
  if (!/^\d{2,5}$/.test(code)) return null;
  for (let len = code.length; len >= 2; len--) {
    const prefix = code.slice(0, len);
    const own = ONLY[codeSet][prefix];
    if (own !== undefined) return own;
    const common = COMMON[prefix];
    if (common !== undefined) return common;
  }
  return null;
}

/** What a TOL code says about an electricity bill: 35.14 trade, 35.13 distribution, "other" for another trade. Null for 35 or another 35.1 code, which say nothing. */
export function electricityRoleOf(code: string): "seller" | "network" | "other" | null {
  if (code.startsWith("3514")) return "seller";
  if (code.startsWith("3513")) return "network";
  return code === "35" || code.startsWith("351") ? null : "other";
}

/** Work the household deduction covers, by TOL code: 81.2 cleaning and 81.3 yard work are labour, 43 building trades carry materials too. */
export function deductibleWorkOf(code: string): "cleaning" | "other" | null {
  return code.startsWith("812") || code.startsWith("813") ? "cleaning" : code.startsWith("43") ? "other" : null;
}

/** What a card code says beyond its category, for the views that split one further (Optimoi's car, tax and kids areas). */
export type MccKind = "parking" | "charging" | "car_service" | "fuel" | "cleaning" | "building" | "child_care";
const MCC_KINDS: ReadonlyArray<readonly [number, number, MccKind]> = [
  [7523, 7523, "parking"],
  [5552, 5552, "charging"],
  [7531, 7549, "car_service"],
  [5541, 5542, "fuel"],
  [7349, 7349, "cleaning"],
  [780, 780, "cleaning"],
  [1520, 1799, "building"],
  [8351, 8351, "child_care"],
];
export function mccKind(mcc: string | null): MccKind | null {
  const code = mcc ? Number(mcc) : Number.NaN;
  return MCC_KINDS.find(([lo, hi]) => code >= lo && code <= hi)?.[2] ?? null;
}

// ── matching a merchant to a registry entry ──────────────

export interface RegistryCompany {
  businessId: string;
  /** Names in use now: the trade name, parallel names and auxiliary trade names. */
  names: string[];
  industry: { code: string; codeSet: IndustryCodeSet; label: string | null } | null;
}

export interface IndustryMatch {
  status: "found" | "none" | "ambiguous";
  businessId: string | null;
  companyName: string | null;
  code: string | null;
  codeSet: IndustryCodeSet | null;
  label: string | null;
  /** Null when the company was found but its industry is too broad. */
  category: string | null;
}

const COMPANY_FORMS = companyForms("strip");

/**
 * "Liikuntakeskus Fressi Oy" → "LIIKUNTAKESKUS FRESSI". Accents are stripped
 * first ("Café" → "CAFE", not "CAF") and every company form at either end
 * goes ("Oy Kahvila Ilo Ab", "Stockmann Oyj Abp").
 */
export function companyKey(name: string): string {
  const words = fold(name.normalize("NFD").replace(/\p{M}/gu, ""))
    .replace(/[^A-Z0-9&]+/g, " ")
    .trim()
    .split(" ");
  let lo = 0;
  let hi = words.length;
  while (lo < hi && COMPANY_FORMS.has(words[lo]!)) lo++;
  while (hi > lo && COMPANY_FORMS.has(words[hi - 1]!)) hi--;
  return words.slice(lo, hi).join(" ");
}

function score(query: string, name: string): number {
  const key = companyKey(name);
  if (!key) return 0;
  if (key === query) return 3;
  if (key.startsWith(`${query} `)) return 2;
  return ` ${key} `.includes(` ${query} `) ? 1 : 0;
}

const NONE: IndustryMatch = { status: "none", businessId: null, companyName: null, code: null, codeSet: null, label: null, category: null };

/**
 * Picks the registry entry for a merchant name. An exact name beats a name
 * that starts with the merchant, which beats one that merely contains it;
 * within the best group every company must point to the same category,
 * otherwise the answer is "ambiguous" and the merchant stays uncategorised.
 */
export function matchCompany(merchant: string, companies: readonly RegistryCompany[], opts: { exactOnly?: boolean } = {}): IndustryMatch {
  const query = companyKey(merchant);
  if (query.length < 3) return NONE;
  let best = 0;
  let group: { company: RegistryCompany; name: string }[] = [];
  for (const company of companies) {
    let top = 0;
    let topName = "";
    for (const name of company.names) {
      const sc = score(query, name);
      if (sc > top) [top, topName] = [sc, name];
    }
    if (top === 0 || top < best) continue;
    if (top > best) [best, group] = [top, []];
    group.push({ company, name: topName });
  }
  if (!group.length || (opts.exactOnly && best < 3)) return NONE;
  // a loose match against many companies is a common word, not this merchant
  if (best < 3 && group.length > 3) return { ...NONE, status: "ambiguous" };

  const withCategory = group.map((g) => ({ ...g, category: g.company.industry ? categoryForIndustry(g.company.industry.code, g.company.industry.codeSet) : null }));
  const categories = new Set(withCategory.map((g) => g.category).filter((c): c is string => c !== null));
  if (categories.size > 1) return { ...NONE, status: "ambiguous" };
  const pick = withCategory.find((g) => g.category !== null) ?? withCategory[0]!;
  if (categories.size === 0 && group.length > 1) return { ...NONE, status: "ambiguous" };
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
  /** The payment's reference number. A stored row has one; the core `Transaction` does not carry it. */
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

/**
 * Letters the cleaning keeps: it knows A to Z and the Nordic letters, and would split "AYŞE" into "AY" and "E" and
 * "RYŁSKI" into "RY" and "SKI". An accent goes, and so does a character nobody sees, which the cleaning would make a
 * space ("HEN" + soft hyphen + "RY"). A letter with no accent to drop (Ł, Ø, Æ, ß, another script) stands as X, so
 * every word stays whole.
 */
const plain = (text: string | null): string => dropUnseen((text ?? "").normalize("NFD")).replace(/[^\P{L}A-Za-z]/gu, "X");

/** One of the bank's texts as a name: cleaned the way the merchant name is made (normalizeMerchant), letters whole. */
const nameIn = (text: string | null): string => fold(cleanDescription(plain(text)));

/**
 * The payee's name as the bank's own text gives it: the payee field, else the payment text. The merchant itself may
 * say less: a brand rule shortens "MAX MEIKALAINEN" to "Max", and a letter the cleaning does not know splits a name
 * into words that read as a company form.
 */
function payeeName(t: Pick<Transaction, "counterparty" | "description">): string {
  return nameIn(t.counterparty) || nameIn(t.description);
}

/** The bank's text that names the payee, as it came. */
const payeeText = (t: Pick<Transaction, "counterparty" | "description">): string => (t.counterparty?.trim() ? t.counterparty : (t.description ?? ""));

/** A processor's or a wallet's prefix before the shop's name, which a card terminal's text has: "SUMUP *KUKKAKAUPPA ILO", "MOB.PAY*STORYTEL OY". */
const TERMINAL_PREFIX = /^\s*[\p{L}\p{N}._]{2,12} ?\*\s*[\p{L}\p{N}]/u;
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

/**
 * An invoice from a business: a payment to an account with a reference number, to a payee whose name says it is a
 * business (wording `namesBusiness`). The reference alone proves nothing: a private landlord gives one too, and the
 * payer typed the payee's name. A row with no payee field is none: its name is the payer's own message.
 */
function isInvoice(t: BusinessRowFields): boolean {
  if (!t.counterpartyIban || !t.reference || !REFERENCE_NUMBER.test(t.reference.replace(/\s+/g, "").toUpperCase())) return false;
  return !!t.counterparty?.trim() && namesBusiness(nameIn(t.counterparty));
}

const NO_NAMES: ReadonlySet<string> = new Set();

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
    if (!shown.has(t.merchant) && hasBusinessEvidence(t, NO_NAMES, NO_NAMES, false)) shown.add(t.merchant);
    if (payeeLedgers.has(ledgerOf(t))) counts.set(t.merchant, (counts.get(t.merchant) ?? 0) + 1);
  }
  return new Set([...shown].filter((merchant) => (counts.get(merchant) ?? 0) >= 2));
}

/**
 * Whether a row of spending pays a business: the register's answer for its merchant may be used on it, and the
 * merchant's name may be asked about when the name itself is no person's (industryCandidates). Positive evidence only:
 *   - a card paid: no payee account, and a merchant code, a card account or the text a card terminal leaves,
 *     or a merchant in `shops` (businessMerchants)
 *   - the payee's name has a company form (Oy, Ab, ry…)
 *   - the bank's text says card purchase, e-invoice or direct payment
 *   - an invoice: a payee account, a reference number and a payee field whose name says it is a business
 * A plain transfer is never enough, and neither is a missing payee account. A MobilePay or PayPal payment to a bare
 * name pays a person, whatever else the row says.
 */
export function isBusinessRow(t: BusinessRowFields, cards: ReadonlySet<string>, shops: ReadonlySet<string> = NO_NAMES): boolean {
  return hasBusinessEvidence(t, cards, shops, isMobilePay(t));
}

function hasBusinessEvidence(t: BusinessRowFields, cards: ReadonlySet<string>, shops: ReadonlySet<string>, mobilePay: boolean): boolean {
  if (paysBareNameByWallet(t, mobilePay)) return false;
  // a payee account means a transfer, also from a card account (credit moved to a person)
  if (!t.counterpartyIban && (t.mcc || cards.has(t.accountId) || hasTerminalShape(t))) return true;
  if (!t.counterpartyIban && t.merchant !== undefined && shops.has(t.merchant) && !mobilePay) return true;
  // in the bank's own text, where a name's letters are whole: the payee field, else the text that names the payee
  if (hasPayeeForm(fold(payeeText(t)))) return true;
  if (t.description && isBusinessPaymentText(fold(t.description))) return true;
  return isInvoice(t);
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
 * Whether a row names a person: its merchant, or the payee's name in the bank's own text, has the shape of a
 * person's name. How whole the name is depends on where the bank has it from. With the payee's account it comes
 * whole, from the payment order. Without one it is a card terminal's or a wallet's and may be cut after two names:
 * there a last word that a name can begin with is no company form ("VIRTANEN LIISA KY"). Behind a prefix it shares
 * a short field and may be cut after one ("MOB.PAY*MEIKALAINEN OSK").
 */
function namesPerson(t: Pick<Transaction, "merchant" | "counterparty" | "counterpartyIban" | "description">): boolean {
  const cutFrom = TERMINAL_PREFIX.test(payeeText(t)) ? 2 : t.counterpartyIban ? Number.POSITIVE_INFINITY : 3;
  return isPersonShaped(fold(t.merchant), cutFrom) || isPersonShaped(payeeName(t), cutFrom);
}

/**
 * Merchants with spending that nothing else categorised, largest total
 * first, limited to those that are clearly businesses: every such row of
 * the merchant is a business row (isBusinessRow) and none names a person.
 */
export function industryCandidates(
  txs: readonly (BusinessRowFields & Pick<Transaction, "amountCents" | "isTransfer" | "categorySource" | "merchant">)[],
  accounts: readonly Pick<Account, "id" | "type">[],
): string[] {
  const cards = new Set(accounts.filter((a) => a.type === "credit_card").map((a) => a.id));
  const totals = new Map<string, number>();
  const ruledOut = new Set<string>();
  const uncategorised = txs.filter((t) => t.amountCents < 0 && !t.isTransfer && t.categorySource === "default" && isLookupName(t.merchant));
  const shops = businessMerchants(uncategorised, ledgersWithPayeeAccounts(txs));
  for (const t of uncategorised) {
    // one row that is a transfer, or that names a person, rules the merchant out
    if (!isBusinessRow(t, cards, shops) || namesPerson(t)) {
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
