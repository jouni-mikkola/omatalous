/**
 * "Miksi?": the line under a panel's title says what the figure stands on, and a bill's row says why its month is not the
 * sum the bank took. Made-up rows only.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { BASIS, basisLine } from "../src/explain/basis.ts";
import { sentenceOf } from "../src/explain/catalogue.ts";
import { explain } from "../src/explain/explain.ts";
import type { Account } from "../src/types.ts";
import { tx } from "./helpers.ts";

const DAY = "2026-11-15";
const RANGE = { from: "2026-11-01", to: "2026-11-15" };

describe("the basis a panel states", () => {
  it("is declared by every figure, in both languages", () => {
    const figures = Object.keys(BASIS) as (keyof typeof BASIS)[];
    expect(figures).toHaveLength(22);
    for (const figure of figures) {
      const fi = basisLine(figure, DAY, "fi");
      const en = basisLine(figure, DAY, "en");
      // a sum of the range's rows is told by the range itself; every other figure says its own basis
      if (BASIS[figure].kind === "rows") expect([figure, fi, en]).toEqual([figure, null, null]);
      else {
        expect(fi, figure).toMatch(/\S/);
        expect(en, figure).toMatch(/\S/);
        expect(en, figure).not.toBe(fi);
      }
    }
  });

  it("says a usual month for the usual levels and the bills, and the day for a figure of today", () => {
    expect(basisLine("expected.spend", DAY)).toBe("Tavallinen kuukausi, viimeiset 6 kk");
    expect(basisLine("bills.fixed", DAY)).toBe("Tavallinen kuukausi, viimeiset 12 kk");
    expect(basisLine("holdings.accounts", DAY)).toBe("Tilanne 15.11.2026");
    expect(basisLine("ahead.free", DAY)).toBe("Tilanne 15.11.2026 seuraavaan palkkapäivään");
    expect(basisLine("spend.month", DAY)).toBeNull();
  });
});

describe("a bill's row says why its month is not the bank's sum", () => {
  const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
  const quarterly = ["2025-10-08", "2026-01-08", "2026-04-08", "2026-07-08"].map((d) => tx({ bookingDate: d, amountCents: -9640, merchant: "If", category: "insurance" }));

  it("tells a quarterly bill's month as a third of the bill", () => {
    const ctx = createContext(quarterly, [checking], "2026-08-01");
    const fixed = explain("bills.fixed", ctx, { view: "own", range: RANGE });
    expect(fixed.lines).toHaveLength(1);
    const line = fixed.lines[0]!;
    expect([line.cents, line.whole]).toEqual([3213, 9640]);
    expect(line.why).toEqual([{ rule: "bill.spread", months: 3 }]);
    expect(sentenceOf(line.why[0]!)).toBe("Lasku tulee 3 kuukauden välein, joten kuukauden osuudeksi laskemme siitä 1/3");
    expect(sentenceOf(line.why[0]!, "en")).toBe("The bill comes every 3 months, so we count 1/3 of it for a month");
    expect(fixed.check).toEqual({ kind: "sum", diffCents: 0 });
  });
});
