// Decision: where to move money to savings
import { coverOf } from "@banking/core";
import { money } from "../format.ts";
import type { DashboardData } from "../types.ts";

export type BridgeTotals = Pick<DashboardData["totals"], "incomeCents" | "consumptionCents" | "debtCents" | "savedCents" | "borrowedCents" | "leftCents">;

export interface BridgePart {
  key: "income" | "consumption" | "debt" | "saved" | "repaid" | "left" | "credit" | "savings" | "accounts" | "credit-left" | "savings-left";
  label: string;
  cents: number;
  color: string;
}

const INCOME = "var(--series-1)";
const CREDIT = "var(--series-4)";
/** Savings have one colour, whether the money went in (Säästöön) or came out: a period never has both. */
const SAVINGS = "var(--series-3)";

/** A sum too small to print: `money` shows whole euros, and "0 €" is no figure. */
const prints = (cents: number) => cents >= 50;
const eur = (cents: number) => money(cents, false);

/**
 * A bar has no place for a part below zero, and without income there is nothing to split. The bridge is drawn only
 * when there is income and no part is below zero (refunds above purchases, income taken back). Any other period is
 * told by the table, where every row is signed and the sum is the same, and nothing is a share of the income
 * (ADR 0014).
 */
export const bridgeDraws = (totals: BridgeTotals): boolean => totals.incomeCents > 0 && totals.consumptionCents >= 0 && totals.debtCents >= 0;

/**
 * Where the money went: the parts of the bar in their fixed order. Each has a colour of its own, none the colour of
 * the income in the chart under it (series 1), since what stayed is a share of the money and not the income itself.
 */
export function bridgeParts(totals: BridgeTotals): BridgePart[] {
  const repaid = coverOf(totals).creditRepaidCents;
  return [
    { key: "consumption", label: "Kulutus", cents: totals.consumptionCents, color: "var(--series-2)" },
    { key: "debt", label: "Velanhoito", cents: totals.debtCents, color: "var(--series-7)" },
    // money taken out of savings is no part of where the money went: it is one of the sources
    { key: "saved", label: "Säästöön", cents: Math.max(0, totals.savedCents), color: SAVINGS },
    ...(repaid > 0 ? [{ key: "repaid" as const, label: "Luottoa maksettu takaisin", cents: repaid, color: "var(--series-6)" }] : []),
    { key: "left", label: "Yli jäi", cents: Math.max(0, totals.leftCents), color: "var(--series-5)" },
  ];
}

/**
 * Where the money of the bar came from, on the bar's own axis and adding up to the same cent. The income pays first.
 * What it did not pay was covered with credit, with savings and from the accounts or a card, in that order (`coverOf`),
 * and drawn money that paid nothing lies under Yli jäi. The third cover is named for both: the totals cannot tell
 * money that was on an account from more owed on a connected card. Empty when the income was all of it: the bar alone says that.
 */
export function bridgeSources(totals: BridgeTotals): BridgePart[] {
  const c = coverOf(totals);
  if (!c.creditDrawnCents && !c.savingsDrawnCents && !c.accountsCents) return [];
  return [
    { key: "income", label: "Tulot", cents: totals.incomeCents, color: INCOME },
    { key: "credit", label: "Katettu luotolla", cents: c.creditCents, color: CREDIT },
    { key: "savings", label: "Katettu säästöistä", cents: c.savingsCents, color: SAVINGS },
    { key: "accounts", label: "Tileiltä tai kortilta", cents: c.accountsCents, color: "var(--series-rest)" },
    { key: "credit-left", label: "Luotosta jäi tilille", cents: c.creditLeftCents, color: CREDIT },
    { key: "savings-left", label: "Nostetuista säästöistä jäi tilille", cents: c.savingsLeftCents, color: SAVINGS },
  ];
}

/** What stayed is a share of the income only when the income was all the money: with drawn money in it, it is none. */
const leftOfIncome = (totals: BridgeTotals): boolean => bridgeDraws(totals) && totals.leftCents >= 0 && bridgeSources(totals).length === 0;

export interface BridgeFigure extends BridgePart {
  /** The figure is a share of the income, so it is also told as one. */
  ofIncome: boolean;
}

/**
 * The figures under the bar, in the order the bridge is read: the income, where it went, how a gap was covered, what
 * stayed. Savings that were drawn and a remainder below zero are no figure of their own: they show as what covered
 * the gap.
 */
export function bridgeFigures(totals: BridgeTotals): BridgeFigure[] {
  const sources = bridgeSources(totals);
  const went = bridgeParts(totals);
  const cover = sources.filter((p) => (p.key === "credit" || p.key === "savings" || p.key === "accounts") && prints(p.cents));
  return [
    { key: "income", label: "Tulot", cents: totals.incomeCents, color: INCOME, ofIncome: false },
    ...went.filter((p) => p.key !== "left" && (p.key !== "saved" || totals.savedCents >= 0)).map((p) => ({ ...p, ofIncome: p.key !== "repaid" })),
    ...cover.map((p) => ({ ...p, ofIncome: false })),
    ...(totals.leftCents >= 0 ? went.filter((p) => p.key === "left").map((p) => ({ ...p, ofIncome: leftOfIncome(totals) })) : []),
  ];
}

export interface BridgeRow {
  key: BridgePart["key"] | "credit-drawn" | "savings-drawn";
  label: string;
  cents: number;
  /** Money in, money out, or what stayed: what came in less what went out is Yli jäi, to the cent. */
  side: "in" | "out" | "stayed";
  /** The row is a share of the income, so it is also told as one. */
  ofIncome: boolean;
}

/** The bridge as a table: the one sum it is, every row in full and signed. The last row is Yli jäi. */
export function bridgeRows(totals: BridgeTotals): BridgeRow[] {
  const c = coverOf(totals);
  const draws = bridgeDraws(totals);
  const came: BridgeRow[] = [
    { key: "income", label: "Tulot", cents: totals.incomeCents, side: "in", ofIncome: draws },
    { key: "credit-drawn", label: "Luottoa nostettu", cents: c.creditDrawnCents, side: "in", ofIncome: false },
    { key: "savings-drawn", label: "Säästöistä nostettu", cents: c.savingsDrawnCents, side: "in", ofIncome: false },
  ];
  const went = bridgeParts(totals)
    .filter((p) => p.key !== "left")
    .map((p): BridgeRow => ({ key: p.key, label: p.label, cents: p.cents, side: "out", ofIncome: draws && p.key !== "repaid" }));
  return [
    ...[...came, ...went].filter((r) => r.cents > 0 || r.key === "income" || r.key === "consumption" || r.key === "debt" || (r.key === "saved" && totals.savedCents >= 0)),
    { key: "left", label: "Yli jäi", cents: totals.leftCents, side: "stayed", ofIncome: leftOfIncome(totals) },
  ];
}

export interface DrawnLine {
  key: "credit" | "savings";
  color: string;
  /** What was drawn. For credit the debt service of the period stands beside it, under the word of its figure. */
  text: string;
  /** How much of it is in Yli jäi; null when it all went to the gap, nothing stayed, or the order alone would say it. */
  stayed: string | null;
}

export interface BridgeText {
  /** How the gap between the income and what the period took was paid; null when the income paid for everything. */
  gap: string | null;
  /** Money that came in without being income: credit drawn and savings drawn. */
  drawn: DrawnLine[];
}

const listed = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} ja ${items.at(-1)}` : `${items[0]}`);

/** What the bridge says in words. Every sum in it is a figure of the bridge, and borrowed money is never income. */
export function bridgeText(totals: BridgeTotals): BridgeText {
  const c = coverOf(totals);
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

/** The income the bridge's sentence names: the figure its change against the usual income is told from. */
export interface BridgeIncome {
  label: "Tulot" | "Ansiotulot";
  cents: number;
  /** Tavalliset tulot to compare with; null when the month has none. */
  usualCents: number | null;
}

/**
 * Usual income is earned income (ADR 0004), so the month is told by its earned income too. While that equals the bar's
 * Tulot the sentence says Tulot; a month with money from people or refunds names the smaller figure Ansiotulot, the
 * income report's word, so one label never carries two sums on the card.
 */
export function bridgeIncome(b: DashboardData["bridge"]): BridgeIncome {
  const earned = b.earnedIncomeCents;
  if (earned === null) return { label: "Tulot", cents: b.totals.incomeCents, usualCents: null };
  return { label: earned === b.totals.incomeCents ? "Tulot" : "Ansiotulot", cents: earned, usualCents: b.usualIncomeCents };
}
