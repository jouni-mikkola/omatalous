import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { newCharges } from "../src/analysis/new-charges.ts";
import { parseSeriesId } from "../src/recurring.ts";
import { NO_INPUTS, type Transaction } from "../src/types.ts";
import { checking, household, monthly, today } from "./charge-fixtures.ts";
import { tx } from "./helpers.ts";

const chargesOf = (txs: Transaction[]) => newCharges(createContext(txs, [checking], today), today, NO_INPUTS);
const merchantsOf = (txs: Transaction[]) => chargesOf(txs).map((c) => c.series.merchant);

describe("newCharges", () => {
  it("an ordinary household has none", () => {
    expect(chargesOf(household())).toEqual([]);
  });

  it("a new subscription after a 1 € trial names the trial", () => {
    const trial = tx({ bookingDate: "2026-07-22", amountCents: -100, merchant: "Storytel", category: "subscriptions" });
    const paid = monthly("2026-08", 5, 3, -2999, { merchant: "Storytel", category: "subscriptions" });
    const found = chargesOf([...household(), trial, ...paid]);
    expect(found.map((c) => c.series.merchant)).toEqual(["Storytel"]);
    expect(found[0]!.trial?.id).toBe(trial.id);
    expect(found[0]!.series.firstDate).toBe("2026-08-05");
    expect(found[0]!.series.yearlyCents).toBe(2999 * 12);
  });

  it("a subscription that moved to another card is not new, a second one running beside it is", () => {
    const sub = { merchant: "Storytel", category: "subscriptions" };
    // the new card was connected long before its first Storytel charge, so a charge there is judged against its own history
    const seen = tx({ bookingDate: "2025-08-02", amountCents: -1000, merchant: "K-Market", category: "groceries", accountId: "acc-2" });
    const oldCard = monthly("2025-08", 5, 12, -2999, sub);
    // the card changed: the last charge on the old account was 5.7., the first on the new one 5.8., the third on 5.10.
    const moved = monthly("2026-08", 5, 3, -2999, { ...sub, accountId: "acc-2" });
    expect(merchantsOf([...household(), seen, ...oldCard, ...moved])).toEqual([]);
    // both cards still pay: a second subscription of the same service
    const both = monthly("2025-08", 5, 14, -2999, sub);
    const second = chargesOf([...household(), seen, ...both, ...moved]);
    expect(second.map((c) => c.series.merchant)).toEqual(["Storytel"]);
    expect(parseSeriesId(second[0]!.series.id)?.accountId).toBe("acc-2");
    // the old card stopped months before: a service taken up again
    const earlier = monthly("2025-08", 5, 8, -2999, sub);
    expect(merchantsOf([...household(), seen, ...earlier, ...moved])).toEqual(["Storytel"]);
    // another service on the new card, not the one that stopped
    const other = monthly("2026-08", 5, 3, -2999, { merchant: "Viaplay", category: "subscriptions", accountId: "acc-2" });
    expect(merchantsOf([...household(), seen, ...oldCard, ...other])).toEqual(["Viaplay"]);
  });

  it("a charge worth under 10 € a month is under the gate of one charge", () => {
    // a new 18,99 € subscription passes; a 119,88 € yearly renewal is 9,99 € a month and stays under
    const storytel = monthly("2026-08", 5, 3, -1899, { merchant: "Storytel", category: "subscriptions" });
    const adobe = [tx({ bookingDate: "2024-10-20", amountCents: -11988, merchant: "Adobe", category: "subscriptions" }), tx({ bookingDate: "2025-10-20", amountCents: -11988, merchant: "Adobe", category: "subscriptions" })];
    expect(merchantsOf([...household(), ...storytel, ...adobe])).toEqual(["Storytel"]);
  });
});
