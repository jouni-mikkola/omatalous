/**
 * Decision: whether to take one more credit, or to gather the ones running into one and pay it down.
 *
 * D5, credit stacking (BA1-behaviour-model.md §D5). A credit line is one lender and one kind of credit seen in the
 * rows: a connected credit card account, the bills of a card that is not connected, a loan's or an instalment
 * service's payments. Two signals, each told only past its gate:
 * - stacking: at least three consumer lines running today, two of them opened in the last 180 days;
 * - credit paying credit: credit drawn, and within 14 days payments beyond the usual instalment to other lines that
 *   add up to half of it or more. A connected card is no such line: its payment follows what was bought with it.
 * A line is opened in the window only when its first row is well inside the history of its account: a line whose rows
 * start with the history may be years old, and is never called new. A card's bills before its account's first rows
 * are the same card (the history before the link), not a second one. A joint account's line is told whole: nobody has
 * said how it is split (owner rule L5), and the result names the accounts so the page can say so.
 * Mortgages and student loans are lines too, but planned ones: they never count toward stacking.
 */
import { dayNumber, fromDayNumber } from "../dates.ts";
import { fold } from "../merchant.ts";
import type { IsoDate } from "../types.ts";
import { isLenderName } from "../wording.ts";
import type { AnalysisContext, AnalysisTx } from "../analysis/context.ts";
import type { Confidence, Fact } from "./fact.ts";

type CreditKind = "card" | "loan" | "instalment" | "collection" | "mortgage" | "student";

interface CreditLine {
  /** `account:<id>` for a connected card, or `<kind>:<folded payee>`. */
  key: string;
  kind: CreditKind;
  payee: string;
  accountIds: string[];
  firstDay: IsoDate;
  lastDay: IsoDate;
  /** The first row is far enough inside its account's history to be the line's start. */
  openedKnown: boolean;
  /** A row in the last 62 days: a missed month does not end a line. */
  active: boolean;
  /** Paid to the line in the 90 days up to today, positive cents. */
  paid90Cents: number;
  rows: string[];
}

/** Credit drawn, and payments to other lines soon after it beyond their usual instalment. */
interface CreditLink {
  drawId: string;
  drawCents: number;
  paymentIds: string[];
  /** What the payments added beyond each line's usual instalment, positive cents. */
  extraCents: number;
}

interface CreditStack {
  lines: CreditLine[];
  /** Consumer lines running today (cards, loans, instalments, collection). */
  active: Fact<number>;
  /** Consumer lines opened in the last `NEW_DAYS` days. */
  opened: Fact<number>;
  links: CreditLink[];
  /** Past the gate of either signal. */
  told: boolean;
}

const ACTIVE_DAYS = 62;
const NEW_DAYS = 180;
/** A line starting this close to its account's first row may be older than the history. */
const HISTORY_EDGE_DAYS = 45;
/** A card's bills ending this close to its account's first row are that card before the link. */
const HANDOVER_DAYS = 45;
const LINK_DAYS = 14;
const MIN_DRAW_CENTS = 20_000;
const LINK_SHARE = 0.5;
const STACK_ACTIVE = 3;
const STACK_NEW = 2;

const PLANNED: ReadonlySet<CreditKind> = new Set(["mortgage", "student"]);
const BY_CATEGORY: Readonly<Record<string, CreditKind>> = { loans: "loan", interest: "loan", collection: "collection", mortgage: "mortgage", student_loan: "student", card_bill: "card" };

/** The line a row belongs to, or null when it is no credit. */
function lineOf(t: AnalysisTx, cardAccounts: ReadonlySet<string>, loanAccounts: ReadonlySet<string>, legOf: (t: AnalysisTx) => string | null): { key: string; kind: CreditKind } | null {
  if (cardAccounts.has(t.accountId)) return { key: `account:${t.accountId}`, kind: "card" };
  // every row out of a loan account reads as a loan payment, so a checking account typed as a loan (the owner's joint
  // account until 0.65) would give a line per shop; the instalments show on the account that pays them
  if (loanAccounts.has(t.accountId) && t.category !== "credit_draw") return null;
  if (t.isTransfer && t.category !== "credit_draw") return null;
  const payee = fold(t.merchant);
  if (t.category === "credit_draw") {
    // a card's own "luoton siirto" lands here as a transfer whose other leg is on the card account
    const card = legOf(t);
    return card ? { key: `account:${card}`, kind: "card" } : { key: `loan:${payee}`, kind: "loan" };
  }
  if (t.amountCents >= 0) return null;
  if (isLenderName(payee) && t.category !== "card_bill") return { key: `instalment:${payee}`, kind: "instalment" };
  const kind = BY_CATEGORY[t.category];
  return kind ? { key: `${kind}:${payee}`, kind } : null;
}

/**
 * What a row paid to its line, positive cents, else 0. On a connected card's own account the money out is purchases
 * and the money in is what was paid to the card; elsewhere the money out is the payment.
 */
const paidTo = (key: string, t: AnalysisTx): number => (key.startsWith("account:") ? (t.accountId === key.slice("account:".length) && t.amountCents > 0 ? t.amountCents : 0) : Math.max(0, -t.amountCents));

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
};

export function creditStack(ctx: AnalysisContext): CreditStack {
  const today = dayNumber(ctx.today);
  const cardAccounts = new Set(ctx.accounts.filter((a) => a.type === "credit_card").map((a) => a.id));
  const loanAccounts = new Set([...ctx.accounts.filter((a) => a.type === "loan").map((a) => a.id), ...ctx.paymentAccounts]);
  const accountStart = new Map<string, number>();
  const found = new Map<string, { kind: CreditKind; payee: string; rows: AnalysisTx[] }>();
  const cardOut = new Map<number, AnalysisTx[]>();
  for (const t of ctx.txs) if (cardAccounts.has(t.accountId) && t.amountCents < 0) cardOut.set(-t.amountCents, [...(cardOut.get(-t.amountCents) ?? []), t]);
  const legOf = (t: AnalysisTx) => (t.isTransfer ? (cardOut.get(t.amountCents)?.find((c) => Math.abs(c.day - t.day) <= 3)?.accountId ?? null) : null);
  for (const t of ctx.txs) {
    if (!accountStart.has(t.accountId)) accountStart.set(t.accountId, dayNumber(t.bookingDate));
    const line = lineOf(t, cardAccounts, loanAccounts, legOf);
    if (!line) continue;
    const at = found.get(line.key);
    if (at) at.rows.push(t);
    else found.set(line.key, { kind: line.kind, payee: (line.key.startsWith("account:") && ctx.accounts.find((a) => `account:${a.id}` === line.key)?.name) || t.merchant, rows: [t] });
  }

  // a card's bills that stop when its account's rows begin are that card before it was linked
  for (const id of cardAccounts) {
    const card = found.get(`account:${id}`);
    if (!card) continue;
    const first = dayNumber(card.rows[0]!.bookingDate);
    for (const [key, l] of found) {
      if (!key.startsWith("account:") && l.kind === "card" && Math.abs(dayNumber(l.rows[l.rows.length - 1]!.bookingDate) - first) <= HANDOVER_DAYS) {
        card.rows = [...l.rows, ...card.rows];
        found.delete(key);
      }
    }
  }

  const lines: CreditLine[] = [];
  for (const [key, l] of found) {
    const rows = l.rows;
    // one payment is no line yet: a single invoice or a one-off fee; a draw or a connected card is one at once
    if (rows.length < 2 && !key.startsWith("account:") && !rows.some((t) => t.category === "credit_draw")) continue;
    const first = dayNumber(rows[0]!.bookingDate);
    const last = dayNumber(rows[rows.length - 1]!.bookingDate);
    const start = Math.min(...rows.map((t) => accountStart.get(t.accountId) ?? first));
    lines.push({
      key,
      kind: l.kind,
      payee: l.payee,
      accountIds: [...new Set(rows.map((t) => t.accountId))].sort(),
      firstDay: fromDayNumber(first),
      lastDay: fromDayNumber(last),
      openedKnown: first - start > HISTORY_EDGE_DAYS,
      active: today - last <= ACTIVE_DAYS,
      paid90Cents: rows.reduce((s, t) => (today - t.day <= 90 ? s + paidTo(key, t) : s), 0),
      rows: rows.map((t) => t.id),
    });
  }
  lines.sort((a, b) => (a.firstDay < b.firstDay ? -1 : a.firstDay > b.firstDay ? 1 : a.key < b.key ? -1 : 1));

  const consumer = lines.filter((l) => !PLANNED.has(l.kind));
  const running = consumer.filter((l) => l.active);
  const fresh = running.filter((l) => l.openedKnown && today - dayNumber(l.firstDay) <= NEW_DAYS);
  const links = linksOf(ctx, found);
  const stacked = running.length >= STACK_ACTIVE && fresh.length >= STACK_NEW;
  // the lines are read by rule from payee names and categories; the counts of rows are known, the lines estimated
  const confidence: Confidence = "estimated";
  return {
    lines,
    active: { value: running.length, confidence, evidence: running.flatMap((l) => l.rows) },
    opened: { value: fresh.length, confidence, evidence: fresh.map((l) => l.rows[0]!) },
    links,
    told: stacked || links.length > 0,
  };
}

/** Each draw of credit followed within `LINK_DAYS` by payments to other lines beyond their usual instalment. */
function linksOf(ctx: AnalysisContext, found: ReadonlyMap<string, { kind: CreditKind; rows: AnalysisTx[] }>): CreditLink[] {
  const lineOfRow = new Map<string, string>();
  for (const [key, l] of found) for (const t of l.rows) lineOfRow.set(t.id, key);
  const links: CreditLink[] = [];
  for (const [key, l] of found) {
    for (const d of l.rows) {
      // the money in is the draw; a card's own leg out of the card account is the same draw
      const drawn = d.category === "credit_draw" && d.amountCents > 0 ? d.amountCents : 0;
      if (drawn < MIN_DRAW_CENTS) continue;
      const paid: AnalysisTx[] = [];
      let extra = 0;
      for (const [other, o] of found) {
        // a connected card's payments follow its purchases, so a large one says nothing of the draw
        if (other === key || PLANNED.has(o.kind) || other.startsWith("account:")) continue;
        const before = o.rows.filter((t) => t.day < d.day && paidTo(other, t) > 0).map((t) => paidTo(other, t));
        const usual = before.length >= 3 ? median(before.slice(-6)) : 0;
        for (const t of o.rows) {
          if (paidTo(other, t) <= 0 || t.day <= d.day || t.day > d.day + LINK_DAYS || lineOfRow.get(t.id) !== other) continue;
          const beyond = paidTo(other, t) - usual;
          if (beyond <= 0) continue;
          paid.push(t);
          extra += beyond;
        }
      }
      if (extra >= drawn * LINK_SHARE) links.push({ drawId: d.id, drawCents: drawn, paymentIds: paid.map((t) => t.id), extraCents: extra });
    }
  }
  return links;
}
