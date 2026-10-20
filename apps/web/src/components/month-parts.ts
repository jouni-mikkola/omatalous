// Decision: where to move money to savings
import type { BridgeFigure, BridgeKey, BridgePiece, BridgeRow, BridgeView } from "@banking/core";
import { money } from "../format.ts";

export interface BridgePart extends BridgePiece {
  label: string;
  color: string;
}

const INCOME = "var(--series-1)";
const CREDIT = "var(--series-4)";
/** Savings have one colour, whether the money went in (Säästöön) or came out: a period never has both. */
const SAVINGS = "var(--series-3)";

/**
 * The name and colour of each part of the bar. None has the colour of the income in the chart under it (series 1),
 * since what stayed is a share of the money and not the income itself.
 */
const PARTS: Record<BridgeKey, { label: string; color: string }> = {
  income: { label: "Tulot", color: INCOME },
  consumption: { label: "Kulutus", color: "var(--series-2)" },
  debt: { label: "Maksettu velanhoito", color: "var(--series-7)" },
  saved: { label: "Säästöön", color: SAVINGS },
  repaid: { label: "Luottoa maksettu takaisin", color: "var(--series-6)" },
  left: { label: "Yli jäi", color: "var(--series-5)" },
  credit: { label: "Katettu luotolla", color: CREDIT },
  savings: { label: "Katettu säästöistä", color: SAVINGS },
  // the totals cannot tell money that was on an account from more owed on a connected card, so it names both
  accounts: { label: "Tileiltä tai kortilta", color: "var(--series-rest)" },
  "credit-left": { label: "Luotosta jäi tilille", color: CREDIT },
  "savings-left": { label: "Nostetuista säästöistä jäi tilille", color: SAVINGS },
};

const ROW_LABELS: Record<BridgeRow["key"], string> = {
  ...Object.fromEntries(Object.entries(PARTS).map(([k, v]) => [k, v.label])),
  "credit-drawn": "Luottoa nostettu",
  "savings-drawn": "Säästöistä nostettu",
} as Record<BridgeRow["key"], string>;

/** A sum too small to print: `money` shows whole euros, and "0 €" is no figure. */
const prints = (cents: number) => cents >= 50;
const eur = (cents: number) => money(cents, false);

/**
 * A bar has no place for a part below zero, and without income there is nothing to split. The bridge is drawn only
 * when there is income and no part is below zero (refunds above purchases, income taken back). Any other period is
 * told by the table, where every row is signed and the sum is the same, and nothing is a share of the income
 * (ADR 0014). Core decides it (`bridgeView`).
 */
export const bridgeDraws = (v: BridgeView): boolean => v.draws;

/** Where the money went: the parts of the bar in their fixed order, each with its share of the bar from the server. */
export function bridgeParts(v: BridgeView): BridgePart[] {
  return v.parts.map((p) => ({ ...p, ...PARTS[p.key] }));
}

/**
 * Where the money of the bar came from, on the bar's own axis and adding up to the same cent. The income pays first.
 * What it did not pay was covered with credit, with savings and from the accounts or a card, in that order (`coverOf`),
 * and drawn money that paid nothing lies under Yli jäi. Empty when the income was all of it: the bar alone says that.
 */
export function bridgeSources(v: BridgeView): BridgePart[] {
  return v.sources.map((p) => ({ ...p, ...PARTS[p.key] }));
}

/**
 * The figures under the bar, in the order the bridge is read: the income, where it went, how a gap was covered, what
 * stayed. Savings that were drawn and a remainder below zero are no figure of their own: they show as what covered
 * the gap.
 */
export function bridgeFigures(v: BridgeView): (BridgeFigure & { label: string; color: string })[] {
  return v.figures.map((f) => ({ ...f, ...PARTS[f.key] }));
}

/** The bridge as a table: the one sum it is, every row in full and signed. The last row is Yli jäi. */
export function bridgeRows(v: BridgeView): (BridgeRow & { label: string })[] {
  return v.rows.map((r) => ({ ...r, label: ROW_LABELS[r.key] }));
}

export interface DrawnLine {
  key: "credit" | "savings";
  color: string;
  /** What was drawn. For credit the debt service of the period stands beside it, under the word of its figure. */
  text: string;
  /** How much of it is in Yli jäi; null when it all went to the gap, nothing stayed, or the order alone would say it. */
  stayed: string | null;
}

interface BridgeText {
  /** How the gap between the income and what the period took was paid; null when the income paid for everything. */
  gap: string | null;
  /** Money that came in without being income: credit drawn and savings drawn. */
  drawn: DrawnLine[];
}

const listed = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} ja ${items.at(-1)}` : `${items[0]}`);

/** What the bridge says in words. Every sum in it is a figure of the bridge, and borrowed money is never income. */
export function bridgeText(v: BridgeView): BridgeText {
  const { totals, cover: c } = v;
  const stays = totals.leftCents > 0;
  const served = prints(totals.debtCents);
  const drawn: DrawnLine[] = [];
  if (prints(c.creditDrawnCents)) {
    drawn.push({
      key: "credit",
      color: CREDIT,
      text: `Luottoa nostettiin ${eur(c.creditDrawnCents)}, velanhoitoon ${served ? `meni ${eur(totals.debtCents)}` : "ei mennyt mitään"}.`,
      // with debt paid in the period, which euro stayed is true by the order of the covers only, so nothing is said
      stayed: !stays || served || !prints(c.creditLeftCents) ? null : c.creditCents === 0 ? "Nostettu luotto on mukana luvussa Yli jäi." : `Luotosta ${eur(c.creditLeftCents)} on mukana luvussa Yli jäi.`,
    });
  }
  // savings that all went to the gap are the figure Katettu säästöistä already
  if (stays && prints(c.savingsLeftCents)) {
    drawn.push({
      key: "savings",
      color: SAVINGS,
      text: `Säästöistä nostettiin ${eur(c.savingsDrawnCents)}, ja ${c.savingsCents === 0 ? "se" : `siitä ${eur(c.savingsLeftCents)}`} on mukana luvussa Yli jäi.`,
      stayed: null,
    });
  }

  // the third cover names both an account and a card: the totals cannot tell which carried the gap
  const paid = [
    { first: "Luotolla", next: "luotolla", alone: "luotolla", cents: c.creditCents },
    { first: "Säästöistä", next: "säästöistä", alone: "säästöistä", cents: c.savingsCents },
    { first: "Tileiltä tai kortilta", next: "tileiltä tai kortilta", alone: "tileillä olleilla rahoilla tai luottokortilla", cents: c.accountsCents },
  ].filter((p) => prints(p.cents));
  if (!paid.length) return { gap: null, drawn };
  const aside = totals.savedCents > 0;
  if (totals.incomeCents === 0) {
    // no income to be short of: the whole of what the period took was covered
    if (paid.length === 1) return { gap: `${aside ? "Menot ja säästöön siirretyt rahat" : "Menot"} katettiin ${paid[0]!.alone}.`, drawn };
    return { gap: `${aside ? "Menoista ja säästöön siirretyistä rahoista" : "Menoista"} katettiin ${listed(paid.map((p) => `${p.next} ${eur(p.cents)}`))}.`, drawn };
  }
  const went = aside ? "Menoihin ja säästöön" : "Menoihin";
  // one cover is the whole gap, the sum its own figure shows; with several the figures are the covers
  if (paid.length === 1) return { gap: `${went} meni ${eur(paid[0]!.cents)} enemmän kuin tuloja tuli. Ero katettiin ${paid[0]!.alone}.`, drawn };
  return { gap: `${went} meni enemmän kuin tuloja tuli. ${listed(paid.map((p, i) => `${i === 0 ? `${p.first} katettiin` : p.next} ${eur(p.cents)}`))}.`, drawn };
}
