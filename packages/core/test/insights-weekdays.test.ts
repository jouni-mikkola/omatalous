import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { weekdays } from "../src/analysis/insights/weekdays.ts";
import type { InsightArgs } from "../src/analysis/insights/types.ts";
import { addDays, weekdayOf } from "../src/dates.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import type { Account, Transaction } from "../src/types.ts";
import { randomHistory } from "./gen.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-09";

describe("weekday insight", () => {
  const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i)).filter((d) => d < today);
  /** A purchase every day of 15 to 29 €, the noise a week has. */
  const daily = days("2026-03-01", 230).map((d, i) => tx({ bookingDate: d, amountCents: -(1500 + ((i * 37) % 15) * 100), category: "groceries", merchant: "K-Market" }));
  const insightOf = (txs: Transaction[], at = today, accounts = [checking]) => {
    const ctx = createContext(txs, accounts, at);
    return weekdays({ ctx, end: at, gateMonthlyCents: 0, lang: "fi" } as unknown as InsightArgs);
  };
  const leadOf = (txs: Transaction[]) => {
    const [found] = insightOf(txs);
    return found ? found.fact : null;
  };

  it("hit: a big shop every Saturday is told, with the weeks it rests on", () => {
    const saturdays = days("2026-03-01", 230).filter((d) => weekdayOf(d) === 5).map((d, i) => tx({ bookingDate: d, amountCents: -(4000 + ((i * 53) % 9) * 800), category: "groceries", merchant: ["Prisma", "Lidl", "K-Citymarket", "S-Market", "Tokmanni", "Motonet", "Clas Ohlson"][(i * i + 3 * i) % 7]! }));
    const lead = leadOf([...daily, ...saturdays]);
    if (lead?.type !== "weekday") throw new Error("no weekday fact");
    const [found] = insightOf([...daily, ...saturdays]);
    expect(lead.weekday).toBe(5);
    expect(found!.comparison.value).toMatchObject({ unit: "cents" });
    expect(lead.cents).toBeGreaterThan(1.5 * (found!.comparison.value as { value: number }).value);
    expect(lead.weeks).toBeGreaterThanOrEqual(24);
  });

  it("hit: the insight tells the weekday, sets it against the other days and counts the year as a calc line", () => {
    const saturdays = days("2026-03-01", 230).filter((d) => weekdayOf(d) === 5).map((d, i) => tx({ bookingDate: d, amountCents: -(4000 + ((i * 53) % 9) * 800), category: "groceries", merchant: ["Prisma", "Lidl", "K-Citymarket", "S-Market", "Tokmanni", "Motonet", "Clas Ohlson"][(i * i + 3 * i) % 7]! }));
    const [found] = insightOf([...daily, ...saturdays]);
    expect(found).toMatchObject({ id: "weekday", kind: "pattern", comparison: { label: "otherDays" }, action: { label: "seeWeekday" } });
    expect(found!.effectPerYear!.cents).toBeLessThan(0);
    expect(found!.evidence.calc.at(-1)).toEqual(found!.effectPerYear);
  });

  it("near miss: an even week names no day", () => {
    expect(leadOf(days("2026-03-01", 230).map((d) => tx({ bookingDate: d, amountCents: -2000, category: "groceries", merchant: "K-Market" })))).toBeNull();
    expect(leadOf(daily)).toBeNull();
  });

  it("near miss: one dear Saturday is no habit", () => {
    expect(leadOf([...daily, tx({ bookingDate: "2026-08-15", amountCents: -90000, category: "home", merchant: "Ikea" })])).toBeNull();
  });

  it("near miss: under eight whole weeks names no day", () => {
    const saturdays = days("2026-08-20", 60).filter((d) => weekdayOf(d) === 5).map((d) => tx({ bookingDate: d, amountCents: -9000, category: "groceries", merchant: "Prisma" }));
    expect(leadOf([...daily.filter((t) => t.bookingDate >= "2026-08-20"), ...saturdays])).toBeNull();
  });

  it("stays quiet on 30 random households", () => {
    const told: string[] = [];
    for (let seed = 1; seed <= 30; seed++) {
      const { txs, accounts, rules } = randomHistory(seed, 600);
      const ctx = createContext(enrichTransactions(txs, accounts, rules), accounts, "2025-11-15");
      for (const i of weekdays({ ctx, end: "2025-11-15", gateMonthlyCents: 0, lang: "fi" } as unknown as InsightArgs)) told.push(`${seed}: ${i.id}`);
    }
    expect(told).toEqual([]);
  }, 30_000);
});
