/**
 * The fixed costs of a year ask for a lender's instalments on every month's last day, and Raportit asks again on each
 * visit: the words of a row are folded once per row list, not once per call, and the answer is the one a new list gives.
 * Isolated: it counts the calls of `fold` through a mock. The demo household with a finance company paid on no steady
 * day, made up.
 */
import { describe, expect, it, vi } from "vitest";
import { contextOf, demoHousehold } from "../../../tools/findings/households.ts";
import { recurringAt, standingById } from "../src/analysis/context.ts";
import { addMonthsToDate } from "../src/dates.ts";
import { lenderInstalments } from "../src/loan-detect.ts";
import { normalizeMerchant } from "../src/merchant.ts";
import { tx } from "./helpers.ts";

const folds = vi.hoisted(() => ({ n: 0 }));
vi.mock("../src/merchant.ts", async (original) => {
  const real = await original<typeof import("../src/merchant.ts")>();
  return { ...real, fold: (text: string) => (folds.n++, real.fold(text)) };
});

/** 215,80 € a month to a finance company, on the 2nd one month and the 27th the next: no cadence, a lender's run. */
const uneven = (accountId: string) => Array.from({ length: 14 }, (_, i) => {
  const date = `${addMonthsToDate("2026-09-01", i - 13).slice(0, 7)}-${i % 2 ? "02" : "27"}`;
  return tx({ id: `uneven-${i}`, accountId, bookingDate: date, amountCents: -21580, counterparty: "ESIMERKKI FINANS AB", merchant: normalizeMerchant("ESIMERKKI FINANS AB", null) });
});

describe("a lender's instalments over a year", () => {
  const demo = demoHousehold();
  const ctx = contextOf({ ...demo, txs: [...demo.txs, ...uneven(demo.accounts.find((a) => a.type === "checking")!.id)] });
  const days = Array.from({ length: 12 }, (_, i) => addMonthsToDate(ctx.today, -i));

  it("folds the rows' words on the first call only, and each day's answer is the one a new row list gives", () => {
    const series = days.map((day) => recurringAt(ctx, day));
    lenderInstalments(ctx);
    folds.n = 0;
    const kept = days.map((day, i) => lenderInstalments(ctx, series[i], day));
    expect(folds.n).toBe(0);
    // a copy of the rows is a list nothing was kept for
    const fresh = { ...ctx, txs: [...ctx.txs] };
    expect(days.map((day, i) => lenderInstalments(fresh, series[i], day))).toEqual(kept);
    expect(folds.n).toBeGreaterThan(0);
    expect(kept.some((series) => series.length > 0)).toBe(true);
  });

  it("looks up a series' rows in one map per row list", () => {
    const byId = standingById(ctx);
    expect(standingById(ctx)).toBe(byId);
    expect([...byId.values()]).toEqual(ctx.txs);
    expect(standingById({ ...ctx, txs: [...ctx.txs] })).not.toBe(byId);
  });
});
