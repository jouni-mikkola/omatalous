/**
 * A card connected late, and a second card never connected. The bills paid from the current account before the card's
 * rows begin, and the bills of the card that is not connected, are card bills: debt service, never purchases. The month
 * the card joins in does not cut the complete months off.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { completeMonthsBefore } from "../src/analysis/usual.ts";
import { normalizeMerchant } from "../src/merchant.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "chk", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" };
const gold: Account = { id: "gold", name: "Nordea Gold", iban: null, currency: "EUR", type: "credit_card" };
const TODAY = "2026-10-18";
/** The Gold card's own rows begin here. */
const FIRST_CARD_ROW = "2026-09-10";
const MONTHS = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];

let n = 0;
function row(accountId: string, bookingDate: string, euros: number, description: string, counterparty: string | null = null, extra: Partial<Transaction> = {}) {
  return tx({ id: `r${++n}`, accountId, bookingDate, amountCents: Math.round(euros * 100), description, counterparty, merchant: normalizeMerchant(counterparty, description), ...extra });
}

/** Pay, rent and groceries on the current account every month, a Gold bill and a Morrow bill of changing sums. */
function household(): Transaction[] {
  const out: Transaction[] = [];
  MONTHS.forEach((m, i) => {
    out.push(row("chk", `${m}-15`, 4000, "PALKKA", "ESIMERKKI OY"));
    out.push(row("chk", `${m}-02`, -1200, "VUOKRA", "ASUNTO OY ESIMERKKI"));
    out.push(row("chk", `${m}-06`, -300, "KORTTIOSTO", "K-MARKET ESIMERKKI"));
    out.push(row("chk", `${m}-20`, -(700 + (i % 4) * 90), "NORDEA GOLD LASKU", "NORDEA RAHOITUS SUOMI OY"));
    out.push(row("chk", `${m}-22`, -(450 + (i % 3) * 120), "MORROW KORTTI LASKU", "MORROW BANK ASA"));
  });
  // the card's own purchases from its first row on
  out.push(row("gold", FIRST_CARD_ROW, -400, "K-CITYMARKET ESIMERKKI"));
  out.push(row("gold", "2026-09-18", -200, "RAVINTOLA ESIMERKKI"));
  return out;
}

function analyse(rows: Transaction[], accounts: Account[]) {
  const sorted = [...rows].sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));
  const changed = new Map(enrichTransactions(sorted, accounts, []).map((t) => [t.id, t]));
  const final = sorted.map((t) => changed.get(t.id) ?? t);
  return { final, ctx: createContext(final, accounts, TODAY) };
}

describe("a card connected late, and one never connected", () => {
  const { final, ctx } = analyse(household(), [checking, gold]);
  const year = buildDashboard(ctx, { from: "2025-10-01", to: "2026-09-30" }).totals;

  it("the bills before the card's first row and the unconnected card's bills are card bills, not purchases", () => {
    const bills = final.filter((t) => t.accountId === "chk" && /LASKU/.test(t.description ?? ""));
    const before = bills.filter((t) => t.bookingDate < FIRST_CARD_ROW);
    expect(before.length).toBe(22);
    expect(before.every((t) => t.category === "card_bill" && !t.isTransfer)).toBe(true);
    // Morrow's card is not connected: its September bill too
    expect(bills.filter((t) => /MORROW/.test(t.description ?? "")).every((t) => t.category === "card_bill" && !t.isTransfer)).toBe(true);
  });

  it("purchases are what the rows hold, and the card bills are debt service: spending stays under income", () => {
    // 12 × (rent 1 200 + groceries 300) and the card's 600 of September
    expect(year.consumptionCents).toBe(12 * 150_000 + 60_000);
    const billCents = final.filter((t) => t.category === "card_bill" && !t.isTransfer).reduce((s, t) => s - t.amountCents, 0);
    expect(year.debtCents).toBe(billCents);
    expect(year.expenseCents).toBe(year.consumptionCents + year.debtCents);
    expect(year.consumptionCents).toBeLessThan(year.incomeCents);
    expect(ctx.txs.filter((t) => t.category === "card_bill").every((t) => t.flows.consumption === 0 && t.kind === "debt")).toBe(true);
  });

  it("an unpaired bill naming the card is a card bill up to a billing month after its first row, a transfer the day after", () => {
    // 10.9. + 31 days = 11.10.: the purchases a bill of that day pays may be older than the card's rows
    const at = (date: string) => {
      const { final } = analyse([...household(), row("chk", date, -500, "NORDEA GOLD LASKU", "NORDEA RAHOITUS SUOMI OY", { id: "probe" })], [checking, gold]);
      return final.find((t) => t.id === "probe")!;
    };
    expect(at("2026-09-28")).toMatchObject({ category: "card_bill", isTransfer: false });
    expect(at("2026-10-11")).toMatchObject({ category: "card_bill", isTransfer: false });
    expect(at("2026-10-12")).toMatchObject({ isTransfer: true });
  });

  it("the month the card joined is skipped, the months before it stay complete", () => {
    expect(completeMonthsBefore(ctx, "2026-10")).toEqual(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
  });
});

describe("near misses", () => {
  it("a Gold bill paid after the card's rows cover a billing month, paired with its payment in, is a transfer", () => {
    const { final } = analyse(
      [...household(), row("chk", "2026-10-14", -600, "NORDEA GOLD LASKU", "NORDEA RAHOITUS SUOMI OY", { id: "oct" }), row("gold", "2026-10-15", 600, "MAKSU", "NORDEA RAHOITUS SUOMI OY")],
      [checking, gold],
    );
    expect(final.find((t) => t.id === "oct")).toMatchObject({ isTransfer: true });
  });

  it("the same sum to the card issuer every month is an instalment, a loan and not a card bill", () => {
    const loan = MONTHS.map((m) => row("chk", `${m}-25`, -150, "MAKSU", "NORDEA RAHOITUS SUOMI OY", { reference: "1232" }));
    const { final } = analyse([...household(), ...loan], [checking, gold]);
    expect(final.filter((t) => t.reference === "1232").every((t) => t.category === "loans")).toBe(true);
  });

  it("a new current account that carries the spending still stops the complete months", () => {
    const second: Account = { id: "chk2", name: "Toinen tili", iban: "FI4950009420028730", currency: "EUR", type: "checking" };
    const big = [row("chk2", "2026-09-10", -3000, "KORTTIOSTO", "VERKKOKAUPPA ESIMERKKI OY"), row("chk2", "2026-10-02", -100, "KORTTIOSTO", "K-MARKET ESIMERKKI")];
    const { ctx } = analyse([...household(), ...big], [checking, gold, second]);
    expect(completeMonthsBefore(ctx, "2026-10")).toEqual([]);
  });
});
