/** One-offs have one owner (ADR 0005): the same sofa is struck by the insights, the change report and Optimoi. */
import { describe, expect, it } from "vitest";
import { spendingChange } from "../src/analysis/change.ts";
import { createContext } from "../src/analysis/context.ts";
import { monthRows, purchasesWithoutOneOff } from "../src/analysis/insights/shared.ts";
import { LEVEL, monthOneOffs, oneOffs, PAY } from "../src/analysis/one-offs.ts";
import { completeMonthsBefore } from "../src/analysis/usual.ts";
import { monthRange } from "../src/dates.ts";
import { levelWithoutOneOffs } from "../src/optimise/common.ts";
import type { Account } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const months = monthRange("2026-02", "2026-09");
const rows = [
  ...months.map((m) => tx({ bookingDate: `${m}-01`, amountCents: 300000, merchant: "Acme Oy", category: "salary" })),
  ...months.flatMap((m) => [3, 10, 17, 24].map((d) => tx({ bookingDate: `${m}-${d}`, amountCents: -4000 - d * 10, merchant: "Sotka", category: "home" }))),
  tx({ id: "sofa", bookingDate: "2026-08-12", amountCents: -89000, merchant: "Sotka", category: "home" }),
];
const ctx = createContext(rows, [checking], "2026-10-11");

describe("one-offs", () => {
  it("the sofa in August is struck by the insights, the change report and Optimoi alike", () => {
    expect(monthOneOffs(ctx, "2026-08", completeMonthsBefore(ctx, "2026-08")).map((t) => t.id)).toEqual(["sofa"]);
    expect(monthRows(ctx, "2026-08").purchases - purchasesWithoutOneOff(ctx, "2026-08")).toBe(89000);
    expect(spendingChange(ctx, "usual", "2026-08")!.pieces.find((p) => p.kind === "oneoff")).toMatchObject({ category: "home", cents: 89000 });
    expect(levelWithoutOneOffs(ctx.txs.filter((t) => t.category === "home"), months).struck).toEqual(["sofa"]);
  });

  it("a sofa in a base month does not move the usual level of the month after", () => {
    const september = spendingChange(ctx, "usual", "2026-09")!;
    // the usual level is the struck months' 165,40 €, so September is no cheaper than usual
    expect(september.baseCents).toBe(16540);
    expect(september.pieces.filter((p) => p.category === "home")).toEqual([]);
  });

  it("bills set the usual ticket and are never struck; pay has its own policy", () => {
    const fixed = new Set(ctx.txs.filter((t) => t.merchant === "Sotka" && t.id !== "sofa").map((t) => t.id));
    expect([...oneOffs(ctx.txs, LEVEL, fixed)]).toEqual(["sofa"]);
    const pay = [1, 2, 3, 4, 5].map((i) => tx({ id: `p${i}`, bookingDate: `2026-0${i}-15`, amountCents: i === 4 ? 450000 : 300000, merchant: "Acme Oy", category: "salary" }));
    expect([...oneOffs(createContext(pay, [checking], "2026-10-11").txs, PAY)]).toEqual(["p4"]);
  });
});
