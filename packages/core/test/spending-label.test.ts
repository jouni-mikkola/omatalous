/**
 * A card bill whose purchases are not itemised is a row of spending with one name in every list that names it: the top
 * categories of the first page, Menot kuukausittain, Kategoriat, the months table and the change of the month.
 * Made-up household only.
 */
import { describe, expect, it } from "vitest";
import { categoryTotals, topCategories } from "../src/analysis/category-totals.ts";
import { createContext } from "../src/analysis/context.ts";
import { spendingLabel } from "../src/category-names.ts";
import { monthRange } from "../src/dates.ts";
import { categoryReport } from "../src/reports/categories.ts";
import { pivotReport } from "../src/reports/pivot.ts";
import { spendingChangeReport } from "../src/reports/spending-change.ts";
import { spendingMonthsReport } from "../src/reports/spending-months.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-11-10";
const range = { from: "2026-05-01", to: "2026-10-31" };
const october = { from: "2026-10-01", to: "2026-10-31" };

/** Seven months of a salary, groceries and a card bill that grows in October. */
const household = (): Transaction[] =>
  monthRange("2026-04", "2026-10").flatMap((m) => [
    tx({ bookingDate: `${m}-01`, amountCents: 300_000, merchant: "Acme Oy", category: "salary" }),
    tx({ bookingDate: `${m}-03`, amountCents: -30_000, merchant: "Prisma", category: "groceries" }),
    tx({ bookingDate: `${m}-12`, amountCents: m === "2026-10" ? -140_000 : -40_000, merchant: "Esimerkkipankki Gold", category: "card_bill" }),
  ]);

describe("the name of the row of card bills without a breakdown", () => {
  it("has a Finnish and an English name and leaves other categories alone", () => {
    expect(spendingLabel({ id: "card_bill", label: "Luottokortin lasku" })).toBe("Korttilaskut ilman erittelyä");
    expect(spendingLabel({ id: "card_bill", label: "Luottokortin lasku" }, "en")).toBe("Card bills without a breakdown");
    expect(spendingLabel({ id: "groceries", label: "Ruokakauppa" })).toBe("Ruokakauppa");
  });

  it.each(["fi", "en"] as const)("is the same in all five lists (%s)", (lang) => {
    const ctx = createContext(household(), [checking], today);
    const name = spendingLabel({ id: "card_bill", label: "Luottokortin lasku" }, lang);
    const only = (labels: (string | undefined)[]) => [...new Set(labels)];

    const totals = categoryTotals(ctx.txs.filter((t) => t.bookingDate >= october.from)).map((c) => ({ ...c, comparedCents: c.cents }));
    const top = topCategories(totals, true, lang).rows.filter((r) => r.category === "card_bill").map((r) => r.label);
    const months = spendingMonthsReport(ctx, range, lang).categories.filter((c) => c.category === "card_bill").map((c) => c.label);
    const categories = categoryReport(ctx, october, lang).groups.flatMap((g) => g.categories).filter((c) => c.category === "card_bill").map((c) => c.label);
    const pivot = pivotReport(ctx, range, lang).rows.filter((r) => r.category === "card_bill").map((r) => r.label);
    const change = spendingChangeReport(ctx, october, lang).views.flatMap((v) => v.change.categories).filter((c) => c.category === "card_bill").map((c) => c.label);

    expect({ top: only(top), months: only(months), categories: only(categories), pivot: only(pivot), change: only(change) }).toEqual({
      top: [name],
      months: [name],
      categories: [name],
      pivot: [name],
      change: [name],
    });
  });
});
