/**
 * Tarkistettavat's guess for a payee nothing classified: the categories the evidence the app already has speaks for,
 * ranked, each with its reason in a short Finnish phrase. Nothing here files a row; the household's answer goes through
 * POST /api/rules as before, so a row the household sorted keeps its category.
 *
 * The evidence, each worth points:
 *   - the household's own answers (rows with category source "user", merchant_exact rules): the same payee, or one of
 *     the same name stem ("HAPPY DOG TRIMMI KALLIO" and "... ESPOO"), 3 a payee, at most two counted
 *   - the payee's name against the lexicon and the trade words (lexicon.ts, trade-words.ts), 3
 *   - a purpose word in the bank's text or the message (wording-shops.ts `purposeCategory`: PUHELINLIITTYMA), 3
 *   - the trade register's industry stored for the payee (`industries`, as the pipeline reads it), 3
 *   - the card code of the payee's rows, when every coded row says the same, 3
 *   - the amount: a monthly payment of the same sum that follows one the household sorted, 2 (support, never alone)
 * The first candidate is the guess only when it has `GUESS_GATE` points and twice the second's. A name with the shape of
 * a person's or a word of the household's names has no candidates: no business category is ever guessed for a person.
 */
import { type CategoryKind, getCategory, isKnownCategory } from "./categories.ts";
import { categoryForMcc } from "./categorize-mcc.ts";
import { categoryByTradeWord, dealerCategory } from "./categorize.ts";
import { daysBetween } from "./dates.ts";
import { companyKey } from "./industry.ts";
import { lexiconCategory } from "./lexicon.ts";
import { fold, isPlaceName } from "./merchant.ts";
import { partyKind } from "./party-kind.ts";
import { namesHousehold } from "./payee-guard.ts";
import type { CategoryRule, Transaction } from "./types.ts";
import { purposeCategory } from "./wording-shops.ts";

type GuessRow = Pick<Transaction, "merchant" | "counterparty" | "description" | "counterpartyIban" | "amountCents" | "bookingDate" | "mcc" | "category" | "categorySource">;

export interface GuessCandidate {
  category: string;
  points: number;
  /** Why, in the page's words: the strongest evidence's phrase. */
  reason: string;
}

interface PayeeRanking {
  candidates: GuessCandidate[];
  /** The first candidate when it passes the gate, else null: the page then offers the household's most used, unmarked. */
  guess: GuessCandidate | null;
}

interface GuessEvidence {
  rows: readonly GuessRow[];
  rules: readonly Pick<CategoryRule, "field" | "pattern" | "category">[];
  /** Merchant to the category its stored register answer gives (the server's `industryMap`). */
  industries: ReadonlyMap<string, string>;
  /** The words of the household's names (`householdWords`). */
  household: ReadonlySet<string>;
}

/** Points the first candidate needs to be shown as the guess, and how many times the second's it must have. */
const GUESS_GATE = 3;
const GUESS_LEAD = 2;
const STRONG = 3;
const SUPPORT = 2;
/** Payees of the household's own answers counted for one category. */
const MAX_SIBLINGS = 2;

/** A monthly run: this many payments of one sum, 25 to 35 days apart. */
const RUN_PAYMENTS = 3;
/** The run that follows one the household sorted begins at most this many days after the old one ended. */
const FOLLOWS_DAYS = 45;

type Side = "out" | "in";

const KINDS: Record<Side, readonly CategoryKind[]> = { out: ["expense", "debt"], in: ["income"] };
const UNSORTED: Record<Side, string> = { out: "other", in: "income" };

const fits = (category: string, side: Side) => isKnownCategory(category) && category !== UNSORTED[side] && KINDS[side].includes(getCategory(category).kind);

/**
 * The stem two payees of one business share: the name without company forms and without the place words at its end, its
 * first two words. A single word shorter than four letters is no stem.
 */
function nameStem(merchant: string): string | null {
  const words = companyKey(merchant).split(" ").filter(Boolean);
  while (words.length > 1 && isPlaceName(words[words.length - 1]!)) words.pop();
  const stem = words.slice(0, 2).join(" ");
  return words.length > 1 || stem.length >= 4 ? stem : null;
}

/**
 * Whether the payee may be a person: then nothing is guessed. Two or three words in the shape of a name with nothing of
 * a company (party-kind.ts), or a word of the household's names. Four plain words are a shop's ("HAPPY DOG TRIMMI
 * ESPOO"): a person's name that long has no evidence of a business to give it a category either.
 */
function maybePerson(merchant: string, rows: readonly GuessRow[], household: ReadonlySet<string>): boolean {
  const names = [merchant, ...rows.map((t) => t.counterparty ?? "")].filter(Boolean);
  return names.some((name) => partyKind(name) === "person" || namesHousehold(name, household));
}

interface Answered {
  merchant: string;
  category: string;
  rows: GuessRow[];
}

/** A monthly run of one sum in the rows: its sum and first and last day, or null. */
function monthlyRun(rows: readonly GuessRow[]): { cents: number; first: string; last: string } | null {
  if (rows.length < RUN_PAYMENTS) return null;
  const sorted = [...rows].sort((a, b) => (a.bookingDate < b.bookingDate ? -1 : 1));
  const cents = sorted[0]!.amountCents;
  if (sorted.some((t) => t.amountCents !== cents)) return null;
  for (let i = 1; i < sorted.length; i++) {
    const gap = daysBetween(sorted[i - 1]!.bookingDate, sorted[i]!.bookingDate);
    if (gap < 25 || gap > 35) return null;
  }
  return { cents, first: sorted[0]!.bookingDate, last: sorted[sorted.length - 1]!.bookingDate };
}

/**
 * The ranking for each payee, the household's answers read once. `rank(merchant, side)` reads the payee's own rows
 * (`merchant` as the pipeline wrote it) and the side its question is on.
 */
export function payeeGuesser(evidence: GuessEvidence): (merchant: string, side: Side) => PayeeRanking {
  const byMerchant = new Map<string, GuessRow[]>();
  for (const t of evidence.rows) {
    const list = byMerchant.get(t.merchant);
    if (list) list.push(t);
    else byMerchant.set(t.merchant, [t]);
  }
  const ruled = new Map<string, string>();
  for (const r of evidence.rules) if (r.field === "merchant_exact") ruled.set(fold(r.pattern.trim()).replace(/\s+/g, " "), r.category);

  // the household's answers, one category a payee: its rule's, else the category most of its own rows were given
  const answered: Answered[] = [];
  for (const [merchant, rows] of byMerchant) {
    const rule = ruled.get(fold(merchant.trim()).replace(/\s+/g, " "));
    const counts = new Map<string, number>();
    for (const t of rows) if (t.categorySource === "user") counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
    const category = rule ?? [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
    if (category) answered.push({ merchant, category, rows });
  }
  const byStem = new Map<string, Answered[]>();
  for (const a of answered) {
    const stem = nameStem(a.merchant);
    if (stem) byStem.set(stem, [...(byStem.get(stem) ?? []), a]);
  }

  return (merchant, side) => {
    const rows = (byMerchant.get(merchant) ?? []).filter((t) => (side === "out" ? t.amountCents < 0 : t.amountCents > 0));
    if (maybePerson(merchant, rows, evidence.household)) return { candidates: [], guess: null };
    const found = new Map<string, { points: number; reasons: [number, string][] }>();
    const add = (category: string, points: number, reason: string) => {
      if (!fits(category, side)) return;
      const c = found.get(category) ?? { points: 0, reasons: [] };
      c.points += points;
      c.reasons.push([points, reason]);
      found.set(category, c);
    };

    // the household's answers: the payee's own sorted rows, then payees of the same stem
    const own = answered.find((a) => a.merchant === merchant);
    const sideRows = (a: Answered) => a.rows.filter((t) => (side === "out" ? t.amountCents < 0 : t.amountCents > 0));
    if (own && sideRows(own).some((t) => t.categorySource === "user")) add(own.category, STRONG, "Osa sen tapahtumista on luokiteltu näin");
    const stem = nameStem(merchant);
    const siblings = new Map<string, number>();
    for (const a of stem ? (byStem.get(stem) ?? []) : []) {
      if (a.merchant === merchant || !sideRows(a).length) continue;
      const seen = siblings.get(a.category) ?? 0;
      if (seen >= MAX_SIBLINGS) continue;
      siblings.set(a.category, seen + 1);
      add(a.category, STRONG, `Sama luokka kuin ${a.merchant}`);
    }

    // the name against the word lists
    const worded = rows.map((t) => lexiconCategory(t)?.category).find(Boolean) ?? categoryByTradeWord(merchant);
    if (worded) add(worded === "vehicle_purchase" ? dealerCategory(largest(rows)) : worded, STRONG, "Nimen perusteella");

    // what the bank's text or the message says the payment was for
    const purpose = rows.map((t) => purposeCategory(fold(t.description ?? ""))).find(Boolean);
    if (purpose) add(purpose, STRONG, "Maksun tekstin perusteella");

    // the register's industry, already stored
    const registered = evidence.industries.get(merchant);
    if (registered) add(registered === "vehicle_purchase" ? dealerCategory(largest(rows)) : registered, STRONG, "Kaupparekisterin toimiala");

    // the card code, when every coded row agrees
    const coded = [...new Set(rows.filter((t) => t.mcc).map((t) => categoryForMcc(t.mcc)))];
    if (coded.length === 1 && coded[0]) add(coded[0], STRONG, "Korttimaksun toimialakoodi");

    // a monthly sum that carries on one the household sorted
    const run = side === "out" ? monthlyRun(rows) : null;
    if (run) {
      for (const a of answered) {
        if (a.merchant === merchant) continue;
        const before = monthlyRun(sideRows(a));
        if (before && before.cents === run.cents && before.last <= run.first && daysBetween(before.last, run.first) <= FOLLOWS_DAYS) {
          add(a.category, SUPPORT, `Sama kuukausisumma kuin ${a.merchant}`);
          break;
        }
      }
    }

    const candidates = [...found]
      .map(([category, c]) => ({ category, points: c.points, reason: c.reasons.sort((a, b) => b[0] - a[0])[0]![1] }))
      .sort((a, b) => b.points - a.points || (a.category < b.category ? -1 : 1));
    const [first, second] = candidates;
    const guess = first && first.points >= GUESS_GATE && first.points >= GUESS_LEAD * (second?.points ?? 0) ? first : null;
    return { candidates, guess };
  };
}

const largest = (rows: readonly GuessRow[]) => rows.reduce((max, t) => Math.max(max, Math.abs(t.amountCents)), 0);
