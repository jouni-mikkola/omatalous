/**
 * Kortin ostot puuttuvat is one figure (`missingCards` in analysis/card-bills.ts) with one title (`missingCardsTitle`):
 * the data quality signal, the first page's reliability line and the questions read it, each over its own range, and
 * no second count of the same words is left in the answers. Names and sums are made up.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { missingCards, missingCardsTitle } from "../src/analysis/card-bills.ts";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { dataQualityReport, knownSpending } from "../src/analysis/data-quality.ts";
import { normalizeMerchant } from "../src/merchant.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const today = "2026-10-09";
const checking: Account = { id: "chk", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const morrowCard: Account = { id: "morrow", name: "Morrow Bank Visa", bank: "Morrow Bank", iban: null, currency: "EUR", type: "credit_card" };
const MONTHS = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];

const row = (id: string, accountId: string, bookingDate: string, amountCents: number, counterparty: string, description: string | null = null): Transaction =>
  tx({ id, accountId, bookingDate, amountCents, counterparty, description, merchant: normalizeMerchant(counterparty, description) });

/** A year of food and of the bills of a card: its purchases are on the card from September on, so the bills before are missing ones. */
const rows = [
  ...MONTHS.map((m, i) => row(`food-${i}`, "chk", `${m}-05`, -50_000, "PRISMA ESIMERKKI")),
  ...MONTHS.map((m, i) => row(`morrow-${i}`, "chk", `${m}-20`, -12_000, "MORROW BANK ASA", "LASKU")),
  row("buy", "morrow", "2026-09-01", -1_000, "K-MARKET ESIMERKKI"),
];

const unconnected = () => createContext(enrichTransactions(rows.filter((t) => t.accountId === "chk"), [checking], []), [checking], today);
const later = () => createContext(enrichTransactions(rows, [checking, morrowCard], []), [checking, morrowCard], today);

/** Each catalogue file of a language whose text says the words. */
const sayers = (dir: URL, pick: (name: string) => boolean, words: string) =>
  readdirSync(dir)
    .filter(pick)
    .flatMap((f) => (readFileSync(new URL(f, dir), "utf8").match(new RegExp(words, "g")) ?? []).map(() => f));

describe("missing card purchases", () => {
  it("has one title in each language", () => {
    expect(sayers(new URL("../src/", import.meta.url), (f) => /^messages.*\.ts$/.test(f), "Kortin ostot puuttuvat")).toEqual(["messages-reports-2.ts"]);
    expect(sayers(new URL("../src/english/", import.meta.url), (f) => f.endsWith(".ts"), "Card purchases are missing")).toEqual(["reports-2.ts"]);
  });

  for (const [what, ctxOf] of [["a card that is not connected", unconnected], ["a card connected later", later]] as const) {
    it(`is the one sum of the signal, the first page and the questions, for ${what}`, () => {
      const ctx = ctxOf();
      const range = { from: "2026-04-01", to: "2026-09-30" };
      const cards = missingCards(ctx, range);
      expect(cards.cents).toBeGreaterThan(0);
      expect(cards.cents).toBe(cards.bills.reduce((s, m) => s + m.cents, 0));

      const signal = dataQualityReport(ctx, range).signals.find((s) => s.id === "card_bills")!;
      expect(signal).toMatchObject({ cents: cards.cents, title: missingCardsTitle(cards.cents), cardPurchases: cards.bills });

      // the first page and the questions read the twelve complete months of the known share
      const year = missingCards(ctx, knownSpending(ctx).window);
      const dashboard = buildDashboard(ctx, { from: "2026-10-01", to: today });
      expect(dashboard.home.reliability.cardGap?.cents).toBe(year.cents);
      expect(dashboard.questions.cardBills).toEqual(year.bills);
      expect(dashboard).not.toHaveProperty("connectNotice");
    });
  }
});
