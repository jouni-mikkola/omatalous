import type { IncomeReport } from "@banking/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { section as income } from "../src/pages/reports/sections/Income.tsx";
import type { ReportContext } from "../src/pages/reports/types.ts";

const groups = [{ id: "earned", label: "Ansiotulot" }, { id: "not_earned", label: "Muut maksut" }];
const by = (earned: number, notEarned = 0) => ({ earned, not_earned: notEarned });
const month = (m: string, cents: number) => ({ month: m, complete: true, totalCents: cents, byGroup: by(cents) });
const type = (over: object = {}) => ({ type: "salary", label: "Palkka", earned: true, group: "earned", totalCents: 30_000_00, monthlyCents: 2_500_00, share: 1, payers: [], ...over });
const steady = { medianCents: 2_500_00, spread: 0.01, steady: true, lowCents: 2_450_00, lowMonth: "2026-03", lowShare: 0.02, worstRunCents: 50_00, worstRunWeeks: 0.5 };

/** An income report of three months with only the parts a test sets. */
const report = (over: Partial<IncomeReport> = {}): IncomeReport =>
  ({
    months: [month("2026-07", 2_500_00), month("2026-08", 2_500_00), month("2026-09", 2_500_00)], completeMonths: 3, enough: true, earnedCents: 7_500_00, notEarnedCents: 0,
    previousEarnedCents: null, earnedChange: null, needs: { compositionMonths: 3, stabilityMonths: 12, previousYearMonths: 24, steadySpread: 0.03 },
    types: [type()], groups, projection: [], markers: [], changes: [], stability: null, payDays: [], members: null, ...over,
  }) as unknown as IncomeReport;
const context = (r: IncomeReport): ReportContext => ({ data: { income: r }, meta: { today: "2026-10-11", accounts: [] }, range: { from: "2026-07-01", to: "2026-09-30" }, scope: "own", exportHref: () => "" }) as unknown as ReportContext;
/** The section as text a test can read: plain spaces. */
const html = (r: IncomeReport) => renderToStaticMarkup(createElement(income.Component, { ctx: context(r) })).replace(/[  ]/g, " ");
const tiles = (out: string) => [...out.matchAll(/<div class="k">((?:<[^>]*>|[^<])*?)<\/div><div class="v">((?:<[^>]*>|[^<])*?)<\/div>/g)].map((m) => `${m[1]!.replace(/<[^>]*>/g, "").replace(/ Miksi\?$/, "")}: ${m[2]!.replace(/<[^>]*>/g, "")}`);

describe("Raportit: Tulot", () => {
  it("is left out until the history can split the income into types", () => {
    expect(income.visible?.(context(report({ enough: false })))).toBe(false);
    expect(income.visible?.(context(report({ enough: true })))).toBe(true);
  });

  it("is headed Tulot with no line under the heading, and has the months as a table with no chart behind a button", () => {
    const out = html(report());
    expect(out).toContain('<h2 id="tulot-h">Tulot</h2>');
    expect(out).not.toMatch(/card-sub|Tulot, \d|nettotulot ilman/);
    expect(out).toContain("<h3>Kuukausittain</h3>");
    expect(out).toContain("<td>heinäkuu 2026</td>");
    expect(out).not.toMatch(/<svg|Taulukko|Kaavio|Tulot kuukausittain tulolajeittain/);
  });

  it("the table holds the months that came, and nothing estimated: no row after today and no sentence about last year's windfalls", () => {
    const out = html(report({ projection: [{ month: "2026-10", byGroup: by(2_500_00) }], markers: [{ month: "2025-12", label: "Lomaraha", cents: 800_00 }] } as unknown as Partial<IncomeReport>));
    expect(out.match(/<tr>/g)?.length).toBeGreaterThanOrEqual(3);
    expect(out).toContain("<td>syyskuu 2026</td>");
    expect(out).not.toMatch(/lokakuu 2026|arvio|projected|Viime vuonna|pylväät/);
    // a month the history covers only in part says so
    expect(html(report({ months: [{ ...month("2026-09", 1_000_00), complete: false }] } as unknown as Partial<IncomeReport>))).toContain("syyskuu 2026 (vajaa)");
  });

  it("Mikä muuttui is drawn only when something changed", () => {
    expect(html(report())).not.toMatch(/Mikä muuttui|Ei muutoksia/);
    const change = { id: "c1", title: "Palkka nousi", detail: "Aiemmin 2 400 € kuussa.", monthlyCents: 100_00, payer: null };
    expect(html(report({ changes: [change] } as unknown as Partial<IncomeReport>))).toContain("<h3>Mikä muuttui</h3>");
  });

  it("the shares of the types add up to 100 as printed, a type that is not earned has a dash and stays out of the rounding", () => {
    const earned = (t: string, totalCents: number) => type({ type: t, label: t, totalCents, share: totalCents / 1_000_00 });
    const types = [earned("salary", 476_00), earned("pension", 378_00), earned("benefit", 146_00), type({ type: "gift", label: "gift", totalCents: 50_00, earned: false, group: "not_earned", share: null })];
    const out = html(report({ earnedCents: 1_000_00, types } as unknown as Partial<IncomeReport>));
    const shares = [...out.matchAll(/<td class="num">(\d+\s%|–)<\/td>/g)].map((m) => m[1]!.replace(/\s/g, " "));
    // 47,6 / 37,8 / 14,6 print 48 + 38 + 15 = 101 when each is rounded on its own
    expect(shares).toEqual(["48 %", "38 %", "14 %", "–"]);
  });

  it("a type that is not earned says nothing about it in its row", () => {
    const out = html(report({ types: [type(), type({ type: "gift", label: "Lahjat", earned: false, group: "not_earned", share: null })] } as unknown as Partial<IncomeReport>));
    expect(out).toContain("Lahjat");
    expect(out).not.toMatch(/ei ansiotuloa|not-earned/);
  });

  it("steady income is two rows and no sentence", () => {
    const out = html(report({ stability: steady }));
    expect(tiles(out).slice(-2)).toEqual(["Tavalliset tulot kuukaudessa: 2 500 €", "Vaihtelu kuukaudesta toiseen: alle 3 %"]);
    expect(out).not.toMatch(/vaihtelivat|Heikoin/);
  });

  it("income that moves tells its weakest month, and a history too short for it draws no block and no sentence", () => {
    const moving = html(report({ stability: { ...steady, steady: false, spread: 0.12 } }));
    expect(tiles(moving).slice(-3)).toEqual(["Tavalliset tulot kuukaudessa: 2 500 €", "Vaihtelu kuukaudesta toiseen: 12 %", "Heikoin kuukausi: maaliskuu 2026, 2 450 €"]);
    const short = html(report({ stability: null }));
    expect(short).not.toMatch(/Vaihtelu|lasketaan/);
  });
});
