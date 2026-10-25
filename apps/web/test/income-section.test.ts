import type { IncomeReport } from "@banking/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { section as income } from "../src/pages/reports/sections/Income.tsx";
import type { ReportContext } from "../src/pages/reports/types.ts";

const groups = [{ id: "earned", label: "Ansiotulot" }, { id: "not_earned", label: "Muut maksut" }];
const by = (earned: number, notEarned = 0) => ({ earned, not_earned: notEarned });
const month = (m: string, cents: number) => ({ month: m, complete: true, totalCents: cents, byGroup: by(cents) });
const type = (over: object = {}) => ({ type: "salary", label: "Palkka", earned: true, group: "earned", totalCents: 30_000_00, monthlyCents: 2_500_00, share: 1, months: [2_500_00, 2_500_00, 2_500_00], previousCents: null, changeCents: null, payers: [], ...over });
const steady = { medianCents: 2_500_00, spread: 0.01, steady: true, lowCents: 2_450_00, lowMonth: "2026-03", lowShare: 0.02, worstRunCents: 50_00, worstRunWeeks: 0.5 };

/** The groups of the types as core gives them, from the types a test sets. */
const kindsOf = (types: IncomeReport["types"]) =>
  [true, false].flatMap((earned) => {
    const own = types.filter((t) => t.earned === earned);
    const add = (f: (t: IncomeReport["types"][number]) => number) => own.reduce((s, t) => s + f(t), 0);
    return own.length ? [{ earned, label: earned ? "Ansiotulot" : "Muut tulot", totalCents: add((t) => t.totalCents), monthlyCents: add((t) => t.monthlyCents ?? 0), months: [0, 1, 2].map((i) => add((t) => t.months[i] ?? 0)), changeCents: null }] : [];
  });

/** An income report of three months with only the parts a test sets; the totals and groups follow from them as core's do. */
const report = (over: Partial<IncomeReport> = {}): IncomeReport => {
  const r = {
    months: [month("2026-07", 2_500_00), month("2026-08", 2_500_00), month("2026-09", 2_500_00)], completeMonths: 3, enough: true, earnedCents: 7_500_00, notEarnedCents: 0,
    previousEarnedCents: null, earnedChange: null, needs: { compositionMonths: 3, stabilityMonths: 12, previousYearMonths: 24, steadySpread: 0.03 },
    types: [type()], groups, projection: [], markers: [], changes: [], stability: null, payDays: [], members: null, unknownCents: 0, ...over,
  } as unknown as IncomeReport;
  return { ...r, totalCents: r.earnedCents + r.notEarnedCents, fromPeopleCents: r.notEarnedCents - r.unknownCents, kinds: kindsOf(r.types) };
};
const context = (r: IncomeReport): ReportContext => ({ data: { income: r }, meta: { today: "2026-10-11", accounts: [] }, range: { from: "2026-07-01", to: "2026-09-30" }, scope: "own", exportHref: () => "" }) as unknown as ReportContext;
/** The section as text a test can read: plain spaces. */
const html = (r: IncomeReport) => renderToStaticMarkup(createElement(income.Component, { ctx: context(r) })).replace(/[  ]/g, " ");

describe("Raportit: Tulot", () => {
  it("is left out until the history can split the income into types", () => {
    expect(income.visible?.(context(report({ enough: false })))).toBe(false);
    expect(income.visible?.(context(report({ enough: true })))).toBe(true);
  });

  it("is headed Tulot with the period's income in the head, asks whether income holds, and has its table view of the months", () => {
    const out = html(report());
    expect(out).toContain('<h2 id="tulot-h">Tulot</h2>');
    expect(out).toContain("Tulot 7 500 €");
    expect(out).toContain("Tuleeko tuloja yhtä paljon kuin ennen?");
    expect(out).toContain('aria-pressed="true">Kaavio');
  });

  it("draws the months that came and nothing estimated: no month after today and no sentence about last year's windfalls", () => {
    const out = html(report({ projection: [{ month: "2026-10", byGroup: by(2_500_00) }], markers: [{ month: "2025-12", label: "Lomaraha", cents: 800_00 }] } as unknown as Partial<IncomeReport>));
    expect(out).not.toMatch(/lokakuu 2026|arvio|Lomaraha|Viime vuonna/);
  });

  it("Mikä tuloissa muuttui is drawn only when something changed", () => {
    expect(html(report())).not.toMatch(/Mikä tuloissa muuttui|Ei muutoksia/);
    const change = { id: "c1", title: "Palkka nousi", detail: "Aiemmin 2 400 € kuussa.", monthlyCents: 100_00, payer: null };
    expect(html(report({ changes: [change] } as unknown as Partial<IncomeReport>))).toContain("Mikä tuloissa muuttui?");
  });

  it("the shares of the types add up to 100 as printed, a type that is not earned has none and stays out of the rounding", () => {
    const earned = (t: string, totalCents: number) => type({ type: t, label: t, totalCents, share: totalCents / 1_000_00 });
    const types = [earned("salary", 476_00), earned("pension", 378_00), earned("benefit", 146_00), type({ type: "gift", label: "gift", totalCents: 50_00, earned: false, group: "not_earned", share: null })];
    const out = html(report({ earnedCents: 1_000_00, types } as unknown as Partial<IncomeReport>));
    const shares = [...out.matchAll(/<span class="rt-barcell">.*?<span>(\d+\s%)<\/span><\/span><\/td>/g)].map((m) => m[1]!.replace(/\s/g, " "));
    // 47,6 / 37,8 / 14,6 print 48 + 38 + 15 = 101 when each is rounded on its own; the table is drawn twice (chart and table view share it) only when the switch says so
    // the Ansiotulot row is the 100 % its types share; Muut tulot and its types say they have no share
    expect(shares).toEqual(["100 %", "48 %", "38 %", "14 %"]);
    expect(out).toContain("ei osuutta");
  });

  it("a type that is not earned says nothing about it in its row", () => {
    const out = html(report({ types: [type(), type({ type: "gift", label: "Lahjat", earned: false, group: "not_earned", share: null })] } as unknown as Partial<IncomeReport>));
    expect(out).toContain("Lahjat");
    expect(out).not.toMatch(/ei ansiotuloa|not-earned/);
  });

  it("steady income is one sentence with the usual level and no weakest month", () => {
    const out = html(report({ stability: steady }));
    // the figure is a button that opens its months (Why); the sentence reads around it
    expect(out.replace(/<[^>]+>/g, "")).toContain("Säännölliset tulot ovat yleensä 2 500 € kuussa, ja ne ovat pysyneet tasaisina.");
    expect(out).toContain('aria-haspopup="dialog"');
    expect(out).not.toContain("Heikoin");
  });

  it("income that moves tells its weakest month, and a history too short for a usual level says what it waits for", () => {
    const moving = html(report({ stability: { ...steady, steady: false, spread: 0.12 } }));
    expect(moving).toContain("Heikoin kuukausi oli maaliskuu 2026, <strong>2 450 €</strong>.");
    expect(html(report({ stability: null }))).toContain("Tavallista tasoa varten tarvitaan 12 valmista kuukautta.");
  });

  it("tells the change of earned income against the same months a year before, and money from people apart", () => {
    const out = html(report({ notEarnedCents: 300_00, unknownCents: 0, earnedChange: 0.05 }));
    expect(out).toContain("Ansiotulot samoihin kuukausiin vuotta aiemmin verrattuna: +5 %.");
    expect(out).toContain("Maksuja henkilöiltä ja hyvityksiä tuli 300 €.");
    expect(out).toContain("Tulot 7 800 €");
  });
});
