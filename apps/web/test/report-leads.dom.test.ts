/** The sentence each Raportit page opens with. Made-up figures only. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "./fixed-clock.ts";
import { page as spending } from "../src/pages/reports/pages/Spending.tsx";
import { BalancesTiles } from "../src/pages/reports/sections/Balances.tsx";
import type { ReportContext } from "../src/pages/reports/types.ts";

const flat = (s: string | null | undefined) => (s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const lead = (Lead: (props: { ctx: ReportContext }) => unknown, data: Record<string, unknown>) =>
  flat(renderToStaticMarkup(createElement(Lead as never, { ctx: { data, range: { from: "2026-09-01", to: "2026-11-11" }, meta: { today: "2026-11-11", accounts: [], sharedAccounts: [] } } as unknown as ReportContext })).replace(/<[^>]*>/g, " "));

describe("Menot kategorioittain: the tiles", () => {
  const categories = (more: Record<string, unknown>) => ({ categories: { totalCents: 250_000, debtPaidCents: 0, creditDrawnCents: 0, ...more } });
  const say = (more: Record<string, unknown>) => lead(spending.Lead!, categories(more));

  it("shows the spending, adding the debt paid and the credit drawn when there are any", () => {
    expect(say({})).toBe("Kaikki menot 2 500 €");
    expect(say({ debtPaidCents: 80_000 })).toBe("Kaikki menot 2 500 € josta velkaa 800 € lyhennykset ja korot");
    expect(say({ creditDrawnCents: 50_000 })).toBe("Kaikki menot 2 500 € Uutta luottoa 500 €");
    expect(say({ debtPaidCents: 80_000, creditDrawnCents: 50_000 })).toBe("Kaikki menot 2 500 € josta velkaa 800 € lyhennykset ja korot Uutta luottoa 500 €");
  });

  it("puts the fees and the debt paid from savings in rows, and only when each is a hundredth of the spending or more", () => {
    expect(say({ feesCents: 7_00 })).toBe("Kaikki menot 2 500 €");
    expect(say({ feesCents: 30_000 })).toBe("Kaikki menot 2 500 € Pankkikulut ja muistutusmaksut 300 €");
  });

  it("shows nothing when nothing was spent", () => {
    expect(say({ totalCents: 0 })).toBe("");
  });
});

describe("Varat ja velat: the tiles", () => {
  const held = { accountsCents: 120_000, debtCents: 0, netCents: 120_000 };
  const owing = { accountsCents: 120_000, debtCents: 30_000, netCents: 90_000 };
  const markup = (holdings: Record<string, unknown>, more: Record<string, unknown> = {}) =>
    renderToStaticMarkup(createElement(BalancesTiles as never, { ctx: { data: { balances: { accounts: [{}], holdings, ...more } }, meta: { today: "2026-11-11", accounts: [], sharedAccounts: [] } } } as never));
  // the tags become spaces so a tile reads label, figure
  const say = (holdings: Record<string, unknown>, more: Record<string, unknown> = {}) => flat(markup(holdings, more).replace(/<[^>]*>/g, " "));

  it("shows what the accounts hold, what is owed and what is left, under the names the groups below have", () => {
    expect(say(held)).toBe("Tilien saldo 1 200 €");
    expect(say(owing)).toBe("Tilien saldo 1 200 € Velat yhteensä 300 € Varat velkojen jälkeen 900 €");
  });

  it("names the debts as the known ones and no net figure while the balance of a debt is missing, with the link to its question", () => {
    const open = { ...owing, netCents: null, unsavedLoans: { count: 1, rows: [{ debtId: "proposal:a" }] } };
    expect(say(open)).toBe("Tilien saldo 1 200 € Velat yhteensä, tiedossa 300 € + 1 velka ilman saldoa");
    expect(markup(open)).toContain('href="#/review?item=loan-terms"');
    // a debt answered "En tiedä" is asked no more, and a lender's few payments never were: the gap has no link
    const asked = { ...owing, netCents: null, unsavedLoans: { count: 1, rows: [{ debtId: "proposal:a", asked: true }] }, unsavedFewPayments: 1 };
    expect(say(asked)).toBe("Tilien saldo 1 200 € Velat yhteensä, tiedossa 300 € + 2 velkaa ilman saldoa");
    // no known debt at all: the accounts alone, and the line
    expect(say({ ...held, netCents: null, unsavedFewPayments: 1 })).toBe("Tilien saldo 1 200 €");
    // a total that cannot be known is said, never left out
    expect(say({ ...held, debtCents: null, netCents: null })).toBe("Tilien saldo 1 200 € Velat yhteensä Ei tiedossa");
  });

  it("says nothing without an account or a known balance", () => {
    expect(say(held, { accounts: [] })).toBe("");
    expect(say({ ...held, accountsCents: null })).toBe("");
  });
});
