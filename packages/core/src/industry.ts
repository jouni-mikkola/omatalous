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
import { fold, isPlaceName, UNKNOWN_MERCHANT } from "./merchant.ts";
import { companyForms, MOBILEPAY_WORDS } from "./wording.ts";
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
 * The name without its last word, for branch names like "Kahvila Ilo
 * Kallio". At least two words besides company forms stay, so it never
 * shrinks to a trade word ("Hammaslääkäri") or a first name ("Tmi Matti
 * Virtanen"). The one exception is a town or district after a single word
 * ("Fysiopiste Tikkurila Oy" → "Fysiopiste"). Match it with `exactOnly`.
 */
export function shorterQuery(merchant: string): string | null {
  const words = merchant.trim().split(/\s+/);
  const core = words.filter((w) => companyKey(w) !== "");
  if (core.length === 2 && isPlaceName(core[1]!) && companyKey(core[0]!).length >= 3) return core[0]!;
  if (words.length < 3) return null;
  const shorter = words.slice(0, -1).join(" ");
  return companyKey(shorter).split(" ").length >= 2 ? shorter : null;
}

// ── which merchants to look up ───────────────────────────

/**
 * Company forms that make a payee a business. The short foreign forms SA, SE
 * and AS are left out: they are too often part of a person's name.
 */
const COMPANY_MARKERS = companyForms("payee");
/** Texts banks put on card purchases and e-invoices, never on a transfer to a person. */
const BUSINESS_PAYMENT =
  /(?<![\p{L}\p{N}])(?:KORTTIOSTO|KORTTIMAKSU|CARD PURCHASE|OSTOPVM|E-LASKU|E-INVOICE|SUORAMAKSU|VERKKOMAKSU)(?![\p{L}\p{N}])|X{2,}\d{2,4}|\*{2,}\d{2,4}/u;

type BusinessRowFields = Pick<Transaction, "mcc" | "accountId" | "counterparty" | "counterpartyIban" | "description">;

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
 * Merchants paid at least twice without a payee account and not with
 * MobilePay: card purchases in a CSV export, which carries no card text.
 * A person is paid to an account, so this counts only rows of a ledger
 * whose other outgoing transfers do carry one. `payeeLedgers` says which
 * (ledgersWithPayeeAccounts) when `txs` is a selection of the rows.
 */
export function businessMerchants(
  txs: readonly Pick<Transaction, "accountId" | "source" | "amountCents" | "merchant" | "counterpartyIban" | "counterparty" | "description">[],
  payeeLedgers: ReadonlySet<string> = ledgersWithPayeeAccounts(txs),
): Set<string> {
  const counts = new Map<string, number>();
  for (const t of txs) {
    if (t.amountCents >= 0 || t.counterpartyIban || t.merchant === UNKNOWN_MERCHANT || !payeeLedgers.has(ledgerOf(t)) || isMobilePay(t)) continue;
    counts.set(t.merchant, (counts.get(t.merchant) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, n]) => n >= 2).map(([merchant]) => merchant));
}

/**
 * A company form as the first or last word. Words are runs of letters of any
 * script, so "AY" is not a word in "AYŞE" nor "SA" in "SAŠA".
 */
export function hasCompanyForm(counterparty: string): boolean {
  const words = fold(counterparty).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.length > 0 && (COMPANY_MARKERS.has(words[0]!) || COMPANY_MARKERS.has(words[words.length - 1]!));
}

/**
 * Whether a row's merchant is a business, so its name may be sent to the
 * public register: a card purchase (merchant code, card account or card
 * text, or a merchant in `shops`, see businessMerchants), an e-invoice or
 * direct payment, or a payee whose name has a company form (Oy, Ab, ry…).
 * A plain transfer is never enough, so names of people are not looked up.
 */
export function isBusinessRow(t: BusinessRowFields & { merchant?: string }, cards: ReadonlySet<string>, shops: ReadonlySet<string> = new Set()): boolean {
  // a payee account means a transfer, also from a card account (credit moved to a person)
  if (!t.counterpartyIban && (t.mcc || cards.has(t.accountId))) return true;
  if (!t.counterpartyIban && t.merchant !== undefined && shops.has(t.merchant) && !isMobilePay(t)) return true;
  if (t.counterparty && hasCompanyForm(t.counterparty)) return true;
  return !!t.description && BUSINESS_PAYMENT.test(fold(t.description));
}

/** A merchant name worth a register search: some letters, not a placeholder. */
export function isLookupName(merchant: string): boolean {
  return merchant !== UNKNOWN_MERCHANT && merchant.length <= 60 && companyKey(merchant).replace(/[^A-Z]/g, "").length >= 3;
}

/**
 * Merchants with spending that nothing else categorised, largest total
 * first, limited to those that are clearly businesses.
 */
export function industryCandidates(
  txs: readonly (BusinessRowFields & Pick<Transaction, "amountCents" | "isTransfer" | "categorySource" | "merchant">)[],
  accounts: readonly Pick<Account, "id" | "type">[],
): string[] {
  const cards = new Set(accounts.filter((a) => a.type === "credit_card").map((a) => a.id));
  const totals = new Map<string, number>();
  const people = new Set<string>();
  const uncategorised = txs.filter((t) => t.amountCents < 0 && !t.isTransfer && t.categorySource === "default" && isLookupName(t.merchant));
  const shops = businessMerchants(uncategorised, ledgersWithPayeeAccounts(txs));
  for (const t of uncategorised) {
    if (!isBusinessRow(t, cards, shops)) {
      people.add(t.merchant);
      continue;
    }
    totals.set(t.merchant, (totals.get(t.merchant) ?? 0) - t.amountCents);
  }
  return [...totals.entries()]
    .filter(([merchant]) => !people.has(merchant))
    .sort((a, b) => b[1] - a[1])
    .map(([merchant]) => merchant);
}
