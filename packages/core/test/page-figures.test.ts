/**
 * Laskut's totals and the sums of its bills ahead have one definition each in core (ADR 0004), so the page adds up
 * nothing: Tilaukset and Sopimukset ja laskut are the fixed costs of the strip, Säännöllinen säästäminen is
 * `fixedSplit`'s savings, and the groups of Erääntyvät maksut are `upcoming` once over with their sums. Which month
 * Yhteenveto opens on is core's too.
 */
import { describe, expect, it } from "vitest";
import { cashAhead, openingMonth, upcomingGroups } from "../src/analysis/ahead.ts";
import { createContext } from "../src/analysis/context.ts";
import { monthWaterfall } from "../src/analysis/waterfall.ts";
import { contractsMonthlyCents, fixedMonthlyCents, fixedSplit, isContract, isSavingsPlan, savingsPlansMonthlyCents, subscriptionsMonthlyCents } from "../src/commitments.ts";
import { type Account, type IsoDate, NO_INPUTS, type Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";
import { contextOf, demoHousehold } from "../../../tools/findings/households.ts";

const h = demoHousehold();
const ctx = contextOf(h);

describe("Laskut's totals", () => {
  it("Tilaukset and Sopimukset ja laskut add up to the fixed costs, with and without a cancelled series", () => {
    const contracts = ctx.recurring.filter(isContract);
    expect(contracts.length).toBeGreaterThan(0);
    expect(subscriptionsMonthlyCents(ctx.recurring) + contractsMonthlyCents(ctx.recurring)).toBe(fixedMonthlyCents(ctx.recurring));
    const gone = new Set([contracts[0]!.merchant]);
    expect(contractsMonthlyCents(ctx.recurring, gone)).toBe(contractsMonthlyCents(ctx.recurring) - contracts.filter((s) => s.merchant === contracts[0]!.merchant).reduce((sum, s) => sum + s.monthlyCents, 0));
    expect(subscriptionsMonthlyCents(ctx.recurring, gone) + contractsMonthlyCents(ctx.recurring, gone)).toBe(fixedMonthlyCents(ctx.recurring, gone));
  });

  it("Säännöllinen säästäminen is the savings of fixedSplit, its rows' sum", () => {
    expect(savingsPlansMonthlyCents(ctx.recurring)).toBe(fixedSplit(ctx.recurring).savingsCents);
    expect(savingsPlansMonthlyCents(ctx.recurring)).toBe(ctx.recurring.filter(isSavingsPlan).reduce((sum, s) => sum + s.monthlyCents, 0));
  });
});

describe("the groups of Erääntyvät maksut", () => {
  it("hold every paying row of upcoming once, in its order, and each sum is its rows'", () => {
    const ahead = cashAhead(ctx, h.balances, NO_INPUTS);
    const groups = upcomingGroups(ahead);
    const paying = ahead.upcoming.flatMap((r, i) => (r.cents !== null && r.cents < 0 ? [i] : []));
    expect(paying.length).toBeGreaterThan(0);
    expect(groups.flatMap((g) => g.rows).sort((a, b) => a - b)).toEqual(paying);
    for (const g of groups) expect(g.cents).toBe(g.rows.reduce((sum, i) => sum - ahead.upcoming[i]!.cents!, 0));
  });

  it("a pay that ends the window splits the list at its day; a bill paid from the pay goes after it; a card's charges are last", () => {
    const row = (date: string, cents: number, more = {}) => ({ date, name: date, category: null, cents, source: "recurring" as const, ...more });
    const upcoming = [row("2026-10-12", -1000), row("2026-10-15", -2000, { withPay: true }), row("2026-10-13", -300, { onCard: true }), row("2026-10-20", -4000), row("2026-10-21", 500)];
    const payday = { date: "2026-10-15", name: "Palkka", pay: null };
    expect(upcomingGroups({ upcoming, to: "2026-10-14", reason: "payday", payday })).toEqual([
      { key: "window", rows: [0], cents: 1000 },
      { key: "after", rows: [1, 3], cents: 6000 },
      { key: "card", rows: [2], cents: 300 },
    ]);
    // near misses: no pay is one group of the days; a pay behind its day with none to come is no end either
    expect(upcomingGroups({ upcoming, to: "2026-10-14", reason: "none", payday: null }).map((g) => [g.key, g.cents])).toEqual([["days", 7000], ["card", 300]]);
    expect(upcomingGroups({ upcoming: upcoming.slice(0, 1), to: "2026-10-14", reason: "payday", payday: { ...payday, expected: "2026-10-09" } })).toEqual([{ key: "days", rows: [0], cents: 1000 }]);
  });
});

describe("the month Yhteenveto opens on", () => {
  const own: Account = { id: "own", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
  // a salary on the 15th (a weekday in each month used) and rent on the 2nd, from January
  const rows = (today: IsoDate): Transaction[] =>
    ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"].flatMap((m) => [
      tx({ accountId: "own", bookingDate: `2026-${m}-15`, amountCents: 300_000, merchant: "Esimerkki Oy", category: "salary" }),
      tx({ accountId: "own", bookingDate: `2026-${m}-02`, amountCents: -90_000, merchant: "Vuokranantaja Oy", category: "housing" }),
    ]).filter((t) => t.bookingDate <= today);
  const opening = (today: IsoDate) => openingMonth(cashAhead(createContext(rows(today), [own], today), [], NO_INPUTS));

  it("is the last complete month until the running month's pay has come, and the running month from the day it has", () => {
    // rent paid, pay to come on Thu 15.10.
    expect(opening("2026-10-03")).toBe("last-month");
    expect(opening("2026-10-14")).toBe("last-month");
    expect(opening("2026-10-15")).toBe("month");
    expect(opening("2026-10-20")).toBe("month");
  });

  it("a household with no regular pay opens on the running month", () => {
    expect(openingMonth({ from: "2026-10-03", payday: null })).toBe("month");
    // a pay behind its day this month has not come
    expect(openingMonth({ from: "2026-10-17", payday: { date: "2026-10-17", expected: "2026-10-15", name: "Palkka", pay: null } })).toBe("last-month");
  });
});

describe("the month's sentence for a reader who does not see the waterfall", () => {
  it("has Tulot, Menot and what went to savings and credit from core, and they are the bars' and add up to Tulos", () => {
    for (const month of ["2026-07", "2026-08", "2026-09"]) {
      const w = monthWaterfall(ctx, month, { from: `${month}-01`, to: `${month}-31` })!;
      const bar = (keep: (key: string) => boolean) => w.bars.filter((b) => keep(b.key)).reduce((s, b) => s + b.cents, 0);
      expect(w.incomeCents).toBe(bar((k) => k === "income"));
      expect(-w.spentCents).toBe(bar((k) => k === "other" || k.startsWith("category:")));
      expect(w.transfersCents).toBe(bar((k) => k === "transfers"));
      expect(w.incomeCents - w.spentCents + w.transfersCents).toBe(w.leftCents);
    }
  });
});
