import type { LoanRow, LoansReport } from "@banking/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { percent } from "../src/format.ts";
import { section as balances } from "../src/pages/reports/sections/Balances.tsx";
import { section as loans } from "../src/pages/reports/sections/Loans.tsx";
import type { ReportContext, ReportSection } from "../src/pages/reports/types.ts";

const day = "2026-10-11";
/** A mortgage with every figure known. Made up, like every loan here. */
const row = (over: Partial<LoanRow> = {}): LoanRow =>
  ({
    id: "home", name: "Kodin laina", lender: "Esimerkkipankki", kind: "mortgage", accountType: null, linkedAccount: null,
    balance: { cents: 12_000_000, unknown: null }, balanceDate: day, rateBp: 325, reference: "euribor_12", repayment: "annuity",
    payment: { cents: 100_000, interestCents: 32_500, amortisationCents: 67_500, intervalMonths: 1, unknown: null },
    interest: { cents: 380_000, unknown: null }, payoff: { date: "2040-02-01", unknown: null, never: false }, scenarios: [],
    ...over,
  }) as LoanRow;
const report = (rows: LoanRow[], over: Partial<LoansReport> = {}) => ({
  day, saved: rows.length, loans: rows, total: { cents: 12_000_000, unknown: [] }, interest: { cents: 380_000, unknown: [] }, interestKnown: true,
  withoutRate: 0, payments: { monthlyCents: 100_000, counted: 1, unknown: 0, bullets: 0 }, maybeTwice: [], overdraftTwice: [], ...over,
});
const balanceData = {
  months: ["2026-09", "2026-10"], total: [100_000, 120_000], accountsLessDebt: [null, -11_880_000],
  accounts: [{ accountId: "a", name: "Käyttötili", asOf: day, values: [100_000, 120_000] }], debt: { day, cents: 12_000_000, savedCents: 12_000_000 },
};
const context = (data: unknown, scope = "own", balances: unknown = balanceData, running = "2026-10"): ReportContext =>
  ({ data: { loans: data, balances }, meta: { today: day, accounts: [] }, running, scope, exportHref: () => "" }) as unknown as ReportContext;
/** The section as text a test can read: plain spaces and a plain minus. */
const html = (s: ReportSection, ctx: ReportContext) => renderToStaticMarkup(createElement(s.Component, { ctx })).replace(/[  ]/g, " ").replace(/−/g, "-");
const figure = (label: string, value: string) => `<dt>${label}</dt><dd>${value}</dd>`;

describe("Raportit: Lainat", () => {
  it("tells a rate with two decimals through the one percent formatter", () => {
    expect(percent(0.0325, 2).replace(/ /g, " ")).toBe("3,25 %");
    expect(percent(-0.005, 2).replace(/ /g, " ")).toBe("−0,50 %");
    expect(percent(0.254).replace(/ /g, " ")).toBe("25 %");
    expect(html(loans, context(report([row()])))).toContain("<dd>3,25 %<small>12 kuukauden Euribor</small></dd>");
  });

  it("a payment without an interval is told without one, and never with the word null", () => {
    const out = html(loans, context(report([row({ payment: { cents: 20_000, interestCents: null, amortisationCents: null, intervalMonths: null, unknown: "interval" } })])));
    expect(out).toContain(figure("Maksuerä", "200,00 €"));
    expect(out).not.toContain("null");
    expect(html(loans, context(report([row()])))).toContain("<dd>1 000,00 €/kk<small>korkoa 325,00 €, lyhennystä 675,00 €</small></dd>");
  });

  it("the day a loan ends is the last payment, and a loan that owes nothing has no payment and no date", () => {
    expect(html(loans, context(report([row()])))).toContain(figure("Viimeinen eräpäivä", "1.2.2040"));
    const none = { cents: null, interestCents: null, amortisationCents: null, intervalMonths: 1, unknown: null };
    const out = html(loans, context(report([row({ balance: { cents: 0, unknown: null }, payment: none, interest: { cents: 0, unknown: null }, payoff: { date: null, unknown: null, never: false } })])));
    expect(out).toContain(figure("Maksuerä", "–"));
    expect(out).toContain(figure("Viimeinen eräpäivä", "–"));
    expect(out).not.toContain("Maksettu");
  });

  it("tells the day of a balance no plan moved forward, and a balance dated ahead, in the words of the form", () => {
    const kept = row({ balance: { cents: 124_000, unknown: "repayment" }, balanceDate: "2026-03-01" });
    expect(html(loans, context(report([kept])))).toContain(`${figure("Velkaa", "1 240,00 €")}`.replace("</dd>", "<small>jäljellä 1.3.2026</small></dd>"));
    const ahead = report([row()], { total: { cents: 0, unknown: [{ loanId: "home", unknown: "before_balance_date", counted: false }] } });
    expect(html(loans, context(ahead))).toContain("Velan summasta puuttuu yksi laina, jonka jäljellä oleva summa on kirjattu tulevalle päivälle.");
  });

  it("a bullet has no payment to tell, in its row, after a move of the rate or in the payments of a month", () => {
    const bullet = row({ repayment: "bullet", payment: { cents: null, interestCents: null, amortisationCents: null, intervalMonths: null, unknown: null }, scenarios: [{ shiftBp: 100, movedBp: 100, rateBp: 425, paymentCents: null, interestCents: 510_000, unknown: null }] });
    const out = html(loans, context(report([bullet], { payments: { monthlyCents: 0, counted: 0, unknown: 0, bullets: 1 } })));
    expect(out).toContain("<dd>Kertalyhennys<small>maksetaan kerralla lopussa</small></dd>");
    expect(out).toContain("Jos viitekorko nousee prosenttiyksikön: korot 12 kuukaudessa 5 100 €.");
    expect(out).toContain('<div class="k">Maksuerät kuussa</div><div class="v">ei maksueriä</div>');
    expect(out).toContain("Kertalyhenteisen lainan korot eivät ole mukana maksuerissä.");
  });

  it("a fall shorter than a point is told as far as it goes, and a sum nothing is known of is not zero", () => {
    const near = row({ scenarios: [{ shiftBp: -100, movedBp: -50, rateBp: 275, paymentCents: 97_000, interestCents: 320_000, unknown: null }] });
    const out = html(loans, context(report([near], { interestKnown: false, payments: { monthlyCents: 0, counted: 0, unknown: 1, bullets: 0 } })));
    expect(out).toContain("Jos viitekorko laskee 0,5 prosenttiyksikköä: maksuerä 970,00 €, korot 12 kuukaudessa 3 200 €.");
    expect(out).toContain('<div class="k">Korot 12 kuukaudessa</div><div class="v">ei tiedossa</div>');
    expect(out).toContain('<div class="k">Maksuerät kuussa</div><div class="v">ei tiedossa</div>');
    expect(out).toContain("Maksueristä puuttuu yksi laina, jonka maksuerää ei tiedetä.");
  });

  it("a debt that may be there twice is named with what fixes it, and nothing tells the household to link", () => {
    const twice = report([row()], { maybeTwice: [{ loans: [{ id: "home", name: "Kodin laina" }, { id: "car", name: "Autolaina" }], accounts: [{ id: "acc", name: "Asuntolaina" }] }] });
    const out = html(loans, context(twice));
    expect(out).toContain("Sama velka voi olla summassa kahdesti: tallennettu laina Kodin laina tai Autolaina ja yhdistetty tili Asuntolaina.");
    expect(out).toContain("Jos velka on sama, poista tallennettu laina kohdassa Asetukset &gt; Lainat, niin se lasketaan kerran.");
    expect(out.toLowerCase()).not.toContain("liitä");
    expect(html(balances, context(twice))).toContain("Sama velka voi olla summassa kahdesti: katso Lainat.");
    expect(html(balances, context(report([row()])))).not.toContain("kahdesti");
  });

  it("two connected accounts beside one saved loan are told in one sentence that lists both", () => {
    const accounts = [{ id: "la", name: "Asuntolaina" }, { id: "la2", name: "Asuntolaina" }, { id: "la3", name: "Autolaina" }];
    const pair = (n: number) => report([row()], { maybeTwice: [{ loans: [{ id: "home", name: "Kodin laina" }], accounts: accounts.slice(0, n) }] });
    const out = html(loans, context(pair(2)));
    expect(out.split("Sama velka voi olla").length - 1).toBe(1);
    expect(out).toContain("Sama velka voi olla summassa kahdesti: tallennettu laina Kodin laina ja yhdistetyt tilit Asuntolaina ja Asuntolaina. Jos velka on sama,");
    expect(html(loans, context(pair(3)))).toContain("tallennettu laina Kodin laina ja yhdistetyt tilit Asuntolaina, Asuntolaina ja Autolaina.");
  });

  it("an overdraft beside a saved credit line is told where the accounts less the debts are, and nowhere else", () => {
    const sentence = "Sama velka voi olla luvussa Tilit miinus velat kahdesti: tallennettu laina Tililuotto ja miinuksella oleva yhdistetty tili Käyttötili. Jos velka on sama, oikea luku on tallennetun lainan verran suurempi.";
    const over = report([row()], { overdraftTwice: [{ loans: [{ id: "cl", name: "Tililuotto" }], accounts: [{ id: "a", name: "Käyttötili" }] }] });
    expect(html(loans, context(over))).toContain(`<li class="warn">${sentence}</li>`);
    expect(html(balances, context(over))).toContain(`Asunnon ja sijoitusten arvo ei ole mukana. ${sentence}</p>`);
    // the debt total holds it once: nothing says "summassa", and Saldot does not send the reader to Lainat for it
    expect(html(loans, context(over)) + html(balances, context(over))).not.toMatch(/summassa|katso Lainat/);
    // a range that ends before today shows no such figure, and no sentence about it
    const earlier = html(loans, context(over, "own", balanceData, "2026-11"));
    expect(earlier).not.toContain("Tilit miinus velat");
    expect(earlier).toContain("Velkaa yhteensä");
    const two = report([row()], { overdraftTwice: [{ loans: [{ id: "cl", name: "Tililuotto" }], accounts: [{ id: "a", name: "Käyttötili" }, { id: "b", name: "Yhteinen tili" }] }] });
    expect(html(loans, context(two))).toContain("tallennettu laina Tililuotto ja miinuksella olevat yhdistetyt tilit Käyttötili ja Yhteinen tili.");
  });

  it("a move of the rate names the payment only when it has one, and a move with no figure has no line", () => {
    const typed = { cents: 10_000, interestCents: null, amortisationCents: null, intervalMonths: 1, unknown: "repayment" } as const;
    const move = (shiftBp: number, paymentCents: number | null, interestCents: number | null) => ({ shiftBp, movedBp: shiftBp, rateBp: 700 + shiftBp, paymentCents, interestCents, unknown: null });
    const line = html(loans, context(report([row({ payment: typed, scenarios: [move(-100, null, 18_000), move(100, null, 24_000)] })])));
    expect(line).toContain('<p class="loan-scenario">Jos viitekorko laskee prosenttiyksikön: korot 12 kuukaudessa 180 €. Jos viitekorko nousee prosenttiyksikön: korot 12 kuukaudessa 240 €.</p>');
    const none = html(loans, context(report([row({ scenarios: [move(-100, null, null), move(100, null, null)] })])));
    expect(none).not.toContain("loan-scenario");
    expect(none).not.toContain("Jos viitekorko");
    const one = html(loans, context(report([row({ scenarios: [move(-100, null, null), move(100, 105_000, 500_000)] })])));
    expect(one).toContain('<p class="loan-scenario">Jos viitekorko nousee prosenttiyksikön: maksuerä 1 050,00 €, korot 12 kuukaudessa 5 000 €.</p>');
  });

  it("the loans the interest leaves out for their rate are the count core gives", () => {
    const later = { cents: 0, unknown: [{ loanId: "home", unknown: "before_balance_date", counted: false }] } as const;
    const out = html(loans, context(report([row()], { interest: later, interestKnown: false, payments: { monthlyCents: 0, counted: 0, unknown: 1, bullets: 0 } })));
    expect(out).not.toContain("Koroista puuttuu");
    expect(out).toContain('<div class="k">Maksuerät kuussa</div><div class="v">ei tiedossa</div>');
    expect(html(loans, context(report([row()], { withoutRate: 2 })))).toContain("Koroista puuttuu 2 lainaa, joiden korkoa ei tiedetä.");
  });

  it("the accounts less the debts are called what they are, say what they leave out, and are not net worth", () => {
    const own = html(loans, context(report([row()]))) + html(balances, context(report([row()])));
    expect(own).toContain('<div class="k">Tilit miinus velat</div><div class="v">-118 800 €</div><div class="loans-tile-sub">Asunnon ja sijoitusten arvo ei ole mukana.</div>');
    expect(own).toContain("Tilit miinus velat tänään -118 800,00 €: tilit yhteensä 1 200,00 €, tallennetut lainat 120 000,00 €. Asunnon ja sijoitusten arvo ei ole mukana.");
    expect(own).not.toContain("Nettovarallisuus");
    expect(own).not.toContain("omasi");
  });

  it("the Saldot line tells its three figures with cents, so they subtract", () => {
    const odd = { ...balanceData, total: [100_000, 300_055], accountsLessDebt: [null, 180_045], debt: { day, cents: 120_010, savedCents: 120_010 } };
    expect(html(balances, context(report([row()]), "own", odd))).toContain("Tilit miinus velat tänään 1 800,45 €: tilit yhteensä 3 000,55 €, tallennetut lainat 1 200,10 €.");
  });

  it("the household view says when another member's saved loan is in it, and the Saldot line calls the saved loans nobody's own", () => {
    const note = "Toisen lisäämä laina on mukana, kun sitä maksetaan tililtä, jonka näet.";
    expect(html(loans, context(report([row()]), "household"))).toContain(note);
    expect(html(loans, context(report([row()])))).not.toContain(note);
    expect(html(balances, context(report([row()]), "household"))).toContain("tilit yhteensä 1 200,00 €, tallennetut lainat 120 000,00 €.");
  });

  it("with a linked loan the Saldot line says its figure holds the loans no account holds", () => {
    const rows = [row(), row({ id: "card", linkedAccount: { id: "a1", name: "Luottokortti" } })];
    for (const scope of ["own", "household"]) expect(html(balances, context(report(rows), scope))).toContain("tilit yhteensä 1 200,00 €, tiliin liittämättömät tallennetut lainat 120 000,00 €.");
  });

  it("a loan another member typed in says who after the kind and the part, and the viewer's own says nothing", () => {
    const theirs = row({ id: "theirs", part: { from: 3, to: 5, of: 5 }, typedBy: "Aino" });
    const out = html(loans, context(report([row(), theirs])));
    expect(out).toContain("<strong>Kodin laina</strong><span>Asuntolaina · Esimerkkipankki · osuutesi 40 % · Lisännyt Aino</span>");
    expect(out).toContain("<strong>Kodin laina</strong><span>Asuntolaina · Esimerkkipankki</span>");
    expect(out.split("Lisännyt").length - 1).toBe(1);
  });

  it("a debt that may be there twice offers no link for a loan another member typed in, and says who can remove it", () => {
    const beside = { loans: [{ id: "home", name: "Kodin laina" }, { id: "theirs", name: "Autolaina" }], accounts: [{ id: "acc", name: "Lainatili" }] };
    const rows = [row(), row({ id: "theirs", name: "Autolaina", typedBy: "Aino" })];
    const withOwn = (r: unknown, accounts: { id: string }[]) => ({ ...context(r), meta: { today: day, accounts } }) as unknown as ReportContext;
    // the viewer's own loan links to the viewer's own account, hers does not
    const linkable = html(loans, withOwn(report(rows, { maybeTwice: [beside] }), [{ id: "acc" }]));
    expect(linkable).toContain("Liitä Kodin laina tiliin Lainatili</a>");
    expect(linkable).not.toContain("Liitä Autolaina");
    expect(linkable).not.toContain("theirs");
    // a set with a loan of the viewer's own and no account to link to: the viewer removes their own, as before
    expect(html(loans, withOwn(report(rows, { maybeTwice: [beside] }), []))).toContain("Jos velka on sama, poista tallennettu laina kohdassa Asetukset &gt; Lainat, niin se lasketaan kerran.");
    // every saved loan of the set is another member's: nothing to link though the account is the viewer's own, and the typists are named once each
    const others = { ...beside, loans: [{ id: "theirs", name: "Autolaina" }, { id: "second", name: "Remonttilaina" }, { id: "his", name: "Venelaina" }] };
    const all = [row({ id: "theirs", typedBy: "Aino" }), row({ id: "second", typedBy: "Aino" }), row({ id: "his", typedBy: "Eero" })];
    const out = html(loans, withOwn(report(all, { maybeTwice: [others] }), [{ id: "acc" }]));
    expect(out).toContain("Jos velka on sama, Aino tai Eero voi poistaa tallennetun lainan kohdassa Asetukset &gt; Lainat, niin se lasketaan kerran.");
    expect(out).not.toContain("Liitä");
    expect(out).not.toContain("<a ");
  });
});
