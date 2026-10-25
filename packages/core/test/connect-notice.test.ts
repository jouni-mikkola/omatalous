/**
 * The one row of the first page for a card or an account that is not connected: the card bills of an issuer with no
 * connected card, and savings sent to an account that is not connected, over the twelve complete months. A bill before
 * a connected card's rows begin is not in it. Names and sums are made up.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { connectNotice, dataQualityReport } from "../src/analysis/data-quality.ts";
import { normalizeMerchant } from "../src/merchant.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const today = "2026-10-09";
const range = { from: "2026-10-01", to: today };
const checking: Account = { id: "chk", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const morrowCard: Account = { id: "morrow", name: "Morrow Bank Visa", bank: "Morrow Bank", iban: null, currency: "EUR", type: "credit_card" };
const MONTHS = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];

/** Amounts are written with a no-break space. */
const plain = (s: string) => s.replace(/\s/g, " ");

const row = (id: string, accountId: string, bookingDate: string, amountCents: number, counterparty: string, description: string | null = null): Transaction =>
  tx({ id, accountId, bookingDate, amountCents, counterparty, description, merchant: normalizeMerchant(counterparty, description) });

const household = (extra: Transaction[] = []): Transaction[] => [
  ...MONTHS.map((m, i) => row(`food-${i}`, "chk", `${m}-05`, -50_000, "PRISMA ESIMERKKI")),
  ...MONTHS.map((m, i) => row(`morrow-${i}`, "chk", `${m}-20`, -12_000, "MORROW BANK ASA", "LASKU")),
  ...extra,
];

function ctxOf(rows: Transaction[], accounts: Account[]) {
  return createContext(enrichTransactions(rows, accounts, []), accounts, today);
}

describe("the card to connect", () => {
  it("a household with a card that is not connected gets one row with the 12 months' bills", () => {
    const ctx = ctxOf(household(), [checking]);
    const notice = connectNotice(ctx)!;
    expect(notice.cents).toBe(12 * 12_000);
    expect(plain(notice.title)).toBe("Korttilaskuja 1 440 € viimeiseltä 12 kuukaudelta, mutta kortin ostot puuttuvat");
    expect(notice.detail).toBe("Yhdistämättömät kortit: Morrow Bank.");
    // the sum is the card_bills signal's own table, not a second count
    const signal = dataQualityReport(ctx, { from: "2025-10-01", to: "2026-09-30" }).signals.find((s) => s.id === "card_bills")!;
    expect(signal.cardPurchases!.filter((m) => m.reason === "not_connected").reduce((s, m) => s + m.cents, 0)).toBe(notice.cents);
  });

  it("the dashboard carries the row and leaves the card bills out of its data notice", () => {
    const d = buildDashboard(ctxOf(household(), [checking]), range);
    expect(d.connectNotice?.cents).toBe(12 * 12_000);
    expect(d.dataNotice?.id).not.toBe("card_bills");
  });

  it("a household with every card connected gets no row", () => {
    // the card's rows begin before the first bill and each bill is paid from the card's side
    const card = [
      row("open", "morrow", "2025-09-01", -1_000, "K-MARKET ESIMERKKI"),
      ...MONTHS.map((m, i) => row(`paid-${i}`, "morrow", `${m}-20`, 12_000, "SUORITUS", "SUORITUS")),
    ];
    const ctx = ctxOf(household(card), [checking, morrowCard]);
    expect(connectNotice(ctx)).toBeNull();
    expect(buildDashboard(ctx, range).connectNotice).toBeNull();
  });

  it("bills before a connected card's rows begin are the bank's history and not in the row", () => {
    const card = [row("buy", "morrow", "2026-09-01", -1_000, "K-MARKET ESIMERKKI"), row("paid", "morrow", "2026-09-20", 12_000, "SUORITUS", "SUORITUS")];
    expect(connectNotice(ctxOf(household(card), [checking, morrowCard]))).toBeNull();
  });

  it("savings sent to an account that is not connected are the row when no card is missing", () => {
    const rows = [row("fund", "chk", "2026-09-20", -50_000, "ESIMERKKI RAHASTO")].map((t) => ({ ...t, category: "savings", categorySource: "rule" as const }));
    const notice = connectNotice(ctxOf([...rows, row("food", "chk", "2026-09-05", -5_000, "PRISMA ESIMERKKI")], [checking]))!;
    expect(notice.cents).toBe(50_000);
    expect(plain(notice.title)).toBe("Säästöön meni 500 € viimeisen 12 kuukauden aikana tilille, jota ei ole yhdistetty");
  });

  it("a household with neither gets no row", () => {
    expect(connectNotice(ctxOf([row("food", "chk", "2026-09-05", -5_000, "PRISMA ESIMERKKI")], [checking]))).toBeNull();
  });
});
