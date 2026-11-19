/**
 * A saved loan of kind mortgage names the payment series it is paid by (`Loan.seriesKey`). That is the household's own
 * word that the series is its home loan, so the rows of the series are `mortgage`, though the bank row carries only a
 * lender's name and a reference number, which the lender rule reads as consumer credit (`loans`).
 *
 * Only a row that rule left as `loans` moves. A row the household or the run settled (own category, transfer, a return,
 * a payer's role) and any other category of the same payee stay as they are. Nothing here reads a name or an amount
 * alone: the row must be a payment of the saved series (`paysSeries`), or the next or previous payment of one. A
 * variable rate moves the payment many times, and a row `paysSeries` does not reach is still the series' when it follows
 * a payment taken a month on or back (`STEP_DAYS_MIN` to `STEP_DAYS` apart), on the same account and payee, and within `STEP_PERCENT` of it in size. Of the rows
 * in one reach the nearest in size is taken, so another loan of the same lender stays as it was, and a row another saved
 * loan's key names is never taken. Every step reads the rows of one payee, so a run of a single merchant
 * (`enrichIsland`) agrees with the full run.
 *
 * A saved loan of kind card likewise names the series of its bills: a bank that issues cards and lends otherwise is paid
 * by its name alone, which the lender rule reads as a credit of unknown kind (`loans`), and the household's answer makes
 * those rows the card's bills (`card_bill`). A card's bill changes every month, so its key holds no amount and every
 * row of the payee on the account that the rule left as `loans`, that names no loan and that no other saved loan's key
 * names moves.
 */
import { daysBetween } from "./dates.ts";
import { fold } from "./merchant.ts";
import { paysSeries } from "./loan-detect.ts";
import type { Loan, Transaction } from "./types.ts";
import { isLoanText } from "./wording.ts";

/** The series keys of the saved loans that are the home loan, in a fixed order so two lists compare. */
export function mortgageSeriesKeys(loans: readonly Loan[]): string[] {
  return loans.flatMap((loan) => (loan.kind === "mortgage" && loan.seriesKey ? [loan.seriesKey] : [])).sort();
}

/** The series keys of the saved card loans, in a fixed order so two lists compare. */
export function cardSeriesKeys(loans: readonly Loan[]): string[] {
  return loans.flatMap((loan) => (loan.kind === "card" && loan.seriesKey ? [loan.seriesKey] : [])).sort();
}

const SETTLED = new Set(["user", "transfer", "match", "payer"]);
/** A payment follows the one before it within this share of the smaller, or 1 EUR, as a rate reset moves it. */
const STEP_PERCENT = 15;
/** The gap between two payments of one series: a month, less the slack of a payment moved to a weekday, to a month and a half. */
const STEP_DAYS_MIN = 20;
const STEP_DAYS = 45;

const stepFits = (a: number, b: number) => Math.abs(a - b) <= Math.max(100, (STEP_PERCENT / 100) * Math.min(Math.abs(a), Math.abs(b)));

/** From each seed along `rows` (in the direction of the walk), takes the payment of the next reach that is nearest in size. */
function walk(rows: readonly Transaction[], seeds: ReadonlySet<string>, taken: Set<string>): void {
  const done = new Set<string>();
  for (const [at, seed] of rows.entries()) {
    if (!seeds.has(seed.id)) continue;
    let last = seed;
    let lastAt = at;
    while (!done.has(last.id)) {
      done.add(last.id);
      let best = -1;
      for (let i = lastAt + 1; i < rows.length; i++) {
        const gap = Math.abs(daysBetween(last.bookingDate, rows[i]!.bookingDate));
        if (gap > STEP_DAYS) break;
        if (gap < STEP_DAYS_MIN || !stepFits(last.amountCents, rows[i]!.amountCents)) continue;
        if (best < 0 || Math.abs(last.amountCents - rows[i]!.amountCents) < Math.abs(last.amountCents - rows[best]!.amountCents)) best = i;
      }
      if (best < 0) break;
      taken.add(rows[best]!.id);
      last = rows[best]!;
      lastAt = best;
    }
  }
}

/** Reads the rows of the saved card loans' series as `card_bill`. Changes `next` in place; no such loan, no change. */
export function applyDeclaredCards(next: readonly Transaction[], locked: ReadonlySet<string>, loans: readonly Loan[] | undefined): void {
  if (!loans?.length) return;
  const keys = cardSeriesKeys(loans);
  if (!keys.length) return;
  const others = loans.flatMap((loan) => loan.seriesKey ?? []);
  // a row another saved loan's key names is that loan's payment, such as an instalment of the same bank
  const rivals = others.filter((key) => !keys.includes(key));
  for (const t of next) {
    if (t.amountCents >= 0 || t.isTransfer || t.category !== "loans" || locked.has(t.id) || SETTLED.has(t.categorySource)) continue;
    if (isLoanText(fold([t.merchant, t.counterparty, t.description].filter(Boolean).join(" ")))) continue;
    if (rivals.some((rival) => paysSeries(rival, t, others))) continue;
    if (keys.some((key) => paysSeries(key, t, others))) Object.assign(t, { category: "card_bill", categorySource: "rule" });
  }
}

/** Reads the rows of the saved home loans' series as `mortgage`. Changes `next` in place; no such loan, no change. */
export function applyDeclaredMortgages(next: readonly Transaction[], locked: ReadonlySet<string>, loans: readonly Loan[] | undefined): void {
  if (!loans?.length) return;
  const keys = mortgageSeriesKeys(loans);
  if (!keys.length) return;
  const others = loans.flatMap((loan) => loan.seriesKey ?? []);
  const loanRows = next.filter((t) => t.amountCents < 0 && !t.isTransfer && (t.category === "loans" || t.category === "mortgage"));
  for (const key of keys) {
    const rivals = others.filter((other) => other !== key);
    const payees = new Map<string, Transaction[]>();
    for (const t of loanRows) {
      if (rivals.some((rival) => paysSeries(rival, t, others))) continue;
      const group = `${t.accountId}\0${t.merchant}`;
      const rows = payees.get(group);
      if (rows) rows.push(t);
      else payees.set(group, [t]);
    }
    for (const rows of payees.values()) {
      const seeds = new Set(rows.filter((t) => paysSeries(key, t, others)).map((t) => t.id));
      if (!seeds.size) continue;
      const taken = new Set(seeds);
      const oldest = [...rows].sort((a, b) => a.bookingDate.localeCompare(b.bookingDate) || a.id.localeCompare(b.id));
      walk(oldest, seeds, taken);
      walk(oldest.reverse(), seeds, taken);
      for (const t of rows) {
        if (taken.has(t.id) && t.category === "loans" && !locked.has(t.id) && !SETTLED.has(t.categorySource)) Object.assign(t, { category: "mortgage", categorySource: "rule" });
      }
    }
  }
}
