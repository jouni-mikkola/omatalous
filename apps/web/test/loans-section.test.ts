import type { LoanRow, LoansReport } from "@banking/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Figure } from "../src/components/Figure.tsx";
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
    payment: { cents: 100_000, interestCents: 32_500, amortisationCents: 67_500, intervalMonths: 1, date: null, unknown: null },
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
const html0 = (e: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(e).replace(/[  ]/g, " ").replace(/−/g, "-");
const html = (s: ReportSection, ctx: ReportContext) => html0(createElement(s.Component, { ctx }));
/** A total as the section prints it: the label and the figure split by `Figure`. */
const tile = (label: string, text: string) => `<div class="k">${label}</div><div class="v">${html0(createElement(Figure, { text, size: "m" }))}</div>`;
const figure = (label: string, value: string) => `<dt>${label}</dt><dd>${value}</dd>`;
/** The same context with the accounts the viewer can see. */
const withAccounts = (data: unknown, accounts: object[]): ReportContext => ({ ...context(data), meta: { today: day, accounts } }) as unknown as ReportContext;
/** The rows of Saldot: label and figure of each, in order. */
const rowsOf = (out: string) => [...out.matchAll(/<dt class="st-name holding-label">([^<]*)<\/dt><dd class="st-num">([^<]*)<\/dd>/g)].map((m) => `${m[1]} ${m[2]}`);
/** The figures of a loan row: label and value of each, in order. */
const figuresOf = (out: string) => [...out.matchAll(/<div><dt>([^<]*)<\/dt><dd[^>]*>([^<]*)/g)].map((m) => `${m[1]} ${m[2]}`);
/** A connected card with 1 240 € used. */
const card = (over: Partial<LoanRow> = {}) =>
  row({ id: "account:c1", name: "Esimerkkikortti Gold", lender: null, kind: "card", accountType: "credit_card", balance: { cents: 124_000, unknown: "repayment" }, rateBp: null, reference: null, repayment: null, payment: { cents: null, interestCents: null, amortisationCents: null, intervalMonths: null, date: null, unknown: "repayment" }, interest: { cents: null, unknown: "rate" }, payoff: { date: null, unknown: "repayment", never: false }, ...over });

describe("Raportit: Lainat", () => {
  it("tells a rate with two decimals through the one percent formatter", () => {
    expect(percent(0.0325, 2).replace(/ /g, " ")).toBe("3,25 %");
    expect(percent(-0.005, 2).replace(/ /g, " ")).toBe("−0,50 %");
    expect(percent(0.254).replace(/ /g, " ")).toBe("25 %");
    expect(html(loans, context(report([row()])))).toContain("<dd>3,25 %<small>12 kuukauden Euribor</small></dd>");
  });

  it("a payment without an interval is told without one, and never with the word null", () => {
    const out = html(loans, context(report([row({ payment: { cents: 20_000, interestCents: null, amortisationCents: null, intervalMonths: null, date: null, unknown: "interval" } })])));
    expect(out).toContain(figure("Maksuerä", "200,00 €"));
    expect(out).not.toContain("null");
    // the interest and the amortisation of the payment are values with a label of their own, not a clause
    const parts = '<dl class="loan-parts"><div><dt>Korko</dt><dd>325,00 €</dd></div><div><dt>Lyhennys</dt><dd>675,00 €</dd></div></dl>';
    expect(html(loans, context(report([row()])))).toContain(`<dd>1 000,00 €/kk${parts}</dd>`);
    expect(html(loans, context(report([row()])))).not.toMatch(/korkoa 325|lyhennystä/);
  });

  it("the day a loan ends is the last payment, and a loan that owes nothing has no payment and no date", () => {
    expect(html(loans, context(report([row()])))).toContain(figure("Viimeinen eräpäivä", "1.2.2040"));
    const none = { cents: null, interestCents: null, amortisationCents: null, intervalMonths: 1, date: null, unknown: null };
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
    const bullet = row({ repayment: "bullet", payment: { cents: null, interestCents: null, amortisationCents: null, intervalMonths: null, date: null, unknown: null }, scenarios: [{ shiftBp: 100, movedBp: 100, rateBp: 425, paymentCents: null, interestCents: 510_000, unknown: null }] });
    const out = html(loans, context(report([bullet], { payments: { monthlyCents: 0, counted: 0, unknown: 0, bullets: 1 } })));
    expect(out).toContain("<dd>Kertalyhennys<small>maksetaan kerralla lopussa</small></dd>");
    expect(out).toContain("Jos viitekorko nousee prosenttiyksikön: korot 12 kuukaudessa 5 100 €.");
    expect(out).toContain(`${tile("Maksuerät kuussa", "ei maksueriä")}`);
    expect(out).not.toContain("korot eivät ole mukana");
  });

  it("a fall shorter than a point is told as far as it goes, and a sum nothing is known of is not zero", () => {
    const near = row({ scenarios: [{ shiftBp: -100, movedBp: -50, rateBp: 275, paymentCents: 97_000, interestCents: 320_000, unknown: null }] });
    const out = html(loans, context(report([near], { interestKnown: false, payments: { monthlyCents: 0, counted: 0, unknown: 1, bullets: 0 } })));
    expect(out).toContain("Jos viitekorko laskee 0,5 prosenttiyksikköä: maksuerä 970,00 €, korot 12 kuukaudessa 3 200 €.");
    expect(out).toContain(`${tile("Korot 12 kuukaudessa", "–")}`);
    expect(out).toContain(`${tile("Maksuerät kuussa", "–")}`);
    expect(out).not.toContain("ei tiedossa");
    expect(out).not.toContain("puuttuu");
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
    const sentence = "Jos tallentamasi laina näkyy myös pankin tiedoissa, se on luvussa Tilit miinus velat kahdesti. Silloin oikea luku on lainan verran suurempi.";
    const over = report([row()], { overdraftTwice: [{ loans: [{ id: "cl", name: "Tililuotto" }], accounts: [{ id: "a", name: "Käyttötili" }] }] });
    expect(html(loans, context(over))).toContain(`<li class="notice warning">${sentence}</li>`);
    expect(html(balances, context(over))).toContain(`<li class="warn">${sentence}</li>`);
    // the debt total holds it once: nothing says "summassa", and Saldot does not send the reader to Lainat for it
    expect(html(loans, context(over)) + html(balances, context(over))).not.toMatch(/summassa|katso Lainat/);
    // a range that ends before today shows no such figure, and no sentence about it
    const earlier = html(loans, context(over, "own", balanceData, "2026-11"));
    expect(earlier).not.toContain("Tilit miinus velat");
    expect(earlier).toContain("Velkaa yhteensä");
    const two = report([row()], { overdraftTwice: [{ loans: [{ id: "cl", name: "Tililuotto" }], accounts: [{ id: "a", name: "Käyttötili" }, { id: "b", name: "Yhteinen tili" }] }] });
    // two accounts below zero are still one figure, so one sentence
    expect(html(loans, context(two)).split("se on luvussa").length - 1).toBe(1);
  });

  it("a move of the rate names the payment only when it has one, and a move with no figure has no line", () => {
    const typed = { cents: 10_000, interestCents: null, amortisationCents: null, intervalMonths: 1, date: null, unknown: "repayment" } as const;
    const move = (shiftBp: number, paymentCents: number | null, interestCents: number | null) => ({ shiftBp, movedBp: shiftBp, rateBp: 700 + shiftBp, paymentCents, interestCents, unknown: null });
    const line = html(loans, context(report([row({ payment: typed, scenarios: [move(-100, null, 18_000), move(100, null, 24_000)] })])));
    expect(line).toContain('<p class="loan-scenario">Jos viitekorko laskee prosenttiyksikön: korot 12 kuukaudessa 180 €. Jos viitekorko nousee prosenttiyksikön: korot 12 kuukaudessa 240 €.</p>');
    const none = html(loans, context(report([row({ scenarios: [move(-100, null, null), move(100, null, null)] })])));
    expect(none).not.toContain("loan-scenario");
    expect(none).not.toContain("Jos viitekorko");
    const one = html(loans, context(report([row({ scenarios: [move(-100, null, null), move(100, 105_000, 500_000)] })])));
    expect(one).toContain('<p class="loan-scenario">Jos viitekorko nousee prosenttiyksikön: maksuerä 1 050,00 €, korot 12 kuukaudessa 5 000 €.</p>');
  });

  it("a figure nothing is known of is a dash in the totals, and no sentence says which loans a total leaves out for it", () => {
    const later = { cents: 0, unknown: [{ loanId: "home", unknown: "before_balance_date", counted: false }] } as const;
    const out = html(loans, context(report([row()], { interest: later, interestKnown: false, payments: { monthlyCents: 0, counted: 0, unknown: 1, bullets: 0 } })));
    expect(out).toContain(`${tile("Maksuerät kuussa", "–")}`);
    expect(out).toContain(`${tile("Korot 12 kuukaudessa", "–")}`);
    expect(html(loans, context(report([row()], { withoutRate: 2 })))).not.toContain("puuttuu");
  });

  it("the accounts less the debts are called what they are, say what they leave out where the figure is, and are not net worth", () => {
    const own = html(loans, context(report([row()]))) + html(balances, context(report([row()])));
    expect(own).toContain(`${tile("Tilit miinus velat", "-118 800 €")}<div class="loans-tile-sub">Asunnon ja sijoitusten arvo ei ole mukana.</div>`);
    // Saldot holds the three figures as rows and no sentence
    const saldot = html(balances, context(report([row()])));
    expect(rowsOf(saldot)).toEqual(["Tilit yhteensä 1 200,00 €", "Tallennetut lainat 120 000,00 €", "Tilit miinus velat -118 800,00 €"]);
    expect(saldot).not.toContain("Asunnon ja sijoitusten arvo");
    expect(saldot).not.toContain("tänään");
    expect(own).not.toContain("Nettovarallisuus");
    expect(own).not.toContain("omasi");
  });

  it("the Saldot rows tell their three figures with cents, so they subtract", () => {
    const odd = { ...balanceData, total: [100_000, 300_055], accountsLessDebt: [null, 180_045], debt: { day, cents: 120_010, savedCents: 120_010 } };
    expect(rowsOf(html(balances, context(report([row()]), "own", odd)))).toEqual(["Tilit yhteensä 3 000,55 €", "Tallennetut lainat 1 200,10 €", "Tilit miinus velat 1 800,45 €"]);
  });

  it("Saldot has no rows for a household that saved no loan, nor for a range that ends before today", () => {
    const none = { ...balanceData, debt: { day, cents: 0, savedCents: 0 } };
    expect(rowsOf(html(balances, context(report([]), "own", none)))).toEqual([]);
    expect(rowsOf(html(balances, context(report([row()]), "own", balanceData, "2026-11")))).toEqual([]);
  });

  it("the household view has no sentence about another member's saved loan", () => {
    expect(html(loans, context(report([row()]), "household"))).not.toContain("Toisen lisäämä");
    expect(rowsOf(html(balances, context(report([row()]), "household")))).toEqual(["Tilit yhteensä 1 200,00 €", "Tallennetut lainat 120 000,00 €", "Tilit miinus velat -118 800,00 €"]);
  });

  it("with a linked loan the Saldot row says its figure holds the loans no account holds", () => {
    const rows = [row(), row({ id: "card", linkedAccount: { id: "a1", name: "Luottokortti" } })];
    for (const scope of ["own", "household"]) expect(rowsOf(html(balances, context(report(rows), scope)))[1]).toBe("Tiliin liittämättömät tallennetut lainat 120 000,00 €");
  });

  it("a loan another member typed in says who after the kind, and the viewer's own says nothing; a part is the labelled value Osuutesi", () => {
    const theirs = row({ id: "theirs", part: { from: 3, to: 5, of: 5 }, typedBy: "Aino" });
    const out = html(loans, context(report([row(), theirs])));
    expect(out).toContain("<strong>Kodin laina</strong><span>Asuntolaina · Esimerkkipankki · Lisännyt Aino</span>");
    expect(out).toContain("<strong>Kodin laina</strong><span>Asuntolaina · Esimerkkipankki</span>");
    expect(out.split("Lisännyt").length - 1).toBe(1);
    expect(out).toContain(figure("Osuutesi", "40 %"));
    expect(out.split("Osuutesi").length - 1).toBe(1);
    expect(out).not.toContain("osuutesi");
  });

  it("the kind is left out under a name that is the kind", () => {
    expect(html(loans, context(report([row({ name: "Asuntolaina" })])))).toContain("<strong>Asuntolaina</strong><span>Esimerkkipankki</span>");
    expect(html(loans, context(report([row({ name: "asuntolaina", lender: null })])))).not.toContain("<span>");
    expect(html(loans, context(report([row({ name: "Asuntolaina 2" })])))).toContain("<strong>Asuntolaina 2</strong><span>Asuntolaina · Esimerkkipankki</span>");
  });

  it("a loan the household can complete has a dash and one link to Lainat in Asetukset, and a loan nobody here can complete has none", () => {
    const link = '<a class="loan-mend" href="#/settings#lainat">Täydennä</a>';
    const untold = { rateBp: null, reference: null, interest: { cents: null, unknown: "rate" } } as const;
    const mine = html(loans, context(report([row(untold)])));
    expect(mine).toContain(figure("Korko", "–").replace("<dd>", '<dd class="unknown">'));
    expect(mine.split("Täydennä").length - 1).toBe(1);
    expect(mine.trimEnd()).toMatch(/Täydennä<\/a><\/li><\/ul><\/section>$/);
    expect(mine).toContain(link);
    // every figure told: nothing to complete. A payment of nothing is a dash that was told, not one that is missing
    const done = { cents: null, interestCents: null, amortisationCents: null, intervalMonths: 1, date: null, unknown: null };
    expect(html(loans, context(report([row()])))).not.toContain("Täydennä");
    expect(html(loans, context(report([row({ balance: { cents: 0, unknown: null }, payment: done, interest: { cents: 0, unknown: null }, payoff: { date: null, unknown: null, never: false } })])))).not.toContain("Täydennä");
    // another member's loan is its typist's to change, and a connected loan account has no saved loan
    expect(html(loans, context(report([row({ ...untold, typedBy: "Aino" })])))).not.toContain("Täydennä");
    expect(html(loans, context(report([row({ ...untold, accountType: "loan" })])))).not.toContain("Täydennä");
  });

  it("a connected card has its used credit and, when the account has a limit, the limit; none of a loan's terms and no link", () => {
    const limited = html(loans, withAccounts(report([card()]), [{ id: "c1", creditLimitCents: 500_000 }]));
    expect(figuresOf(limited)).toEqual(["Käytetty luotto 1 240,00 €", "Luottoraja 5 000,00 €"]);
    // the list of the loans, not the totals above it
    const list = limited.slice(limited.indexOf('<ul class="loan-list">'));
    for (const word of ["Korko", "Maksuerä", "Korot 12 kuukaudessa", "Viimeinen eräpäivä", "Yhdistetty tili", "jäljellä", "Täydennä", "ei tiedossa"]) expect(list, word).not.toContain(word);
    expect(list).toContain("<strong>Esimerkkikortti Gold</strong></div>");
    // no limit told, or one of nothing: the used credit alone
    expect(figuresOf(html(loans, withAccounts(report([card()]), [{ id: "c1", creditLimitCents: null }])))).toEqual(["Käytetty luotto 1 240,00 €"]);
    expect(figuresOf(html(loans, withAccounts(report([card()]), [{ id: "c1", creditLimitCents: 0 }])))).toEqual(["Käytetty luotto 1 240,00 €"]);
    // the limit is the account's: a card the viewer has a part of shows the part used and its share, no limit beside it
    const half = html(loans, withAccounts(report([card({ part: { from: 0, to: 2, of: 5 } })]), [{ id: "c1", creditLimitCents: 500_000 }]));
    expect(figuresOf(half)).toEqual(["Käytetty luotto 1 240,00 €", "Osuutesi 40 %"]);
    // a saved loan of the kind card is a loan with the terms of one
    expect(figuresOf(html(loans, withAccounts(report([row({ kind: "card", name: "Kaupan kortti" })]), [{ id: "c1", creditLimitCents: 500_000 }]))).map((f) => f.split(" ")[0])).toEqual(["Velkaa", "Korko", "Maksuerä", "Korko", "Lyhennys", "Korot", "Viimeinen"]);
  });

  it("a debt that may be there twice offers no link for a loan another member typed in, and says who can remove it", () => {
    const beside = { loans: [{ id: "home", name: "Kodin laina" }, { id: "theirs", name: "Autolaina" }], accounts: [{ id: "acc", name: "Lainatili" }] };
    const rows = [row(), row({ id: "theirs", name: "Autolaina", typedBy: "Aino" })];
    // the viewer's own loan links to the viewer's own account, hers does not
    const linkable = html(loans, withAccounts(report(rows, { maybeTwice: [beside] }), [{ id: "acc" }]));
    expect(linkable).toContain("Liitä Kodin laina tiliin Lainatili</a>");
    expect(linkable).not.toContain("Liitä Autolaina");
    expect(linkable).not.toContain("theirs");
    // a set with a loan of the viewer's own and no account to link to: the viewer removes their own, as before
    expect(html(loans, withAccounts(report(rows, { maybeTwice: [beside] }), []))).toContain("Jos velka on sama, poista tallennettu laina kohdassa Asetukset &gt; Lainat, niin se lasketaan kerran.");
    // every saved loan of the set is another member's: nothing to link though the account is the viewer's own, and the typists are named once each
    const others = { ...beside, loans: [{ id: "theirs", name: "Autolaina" }, { id: "second", name: "Remonttilaina" }, { id: "his", name: "Venelaina" }] };
    const all = [row({ id: "theirs", typedBy: "Aino" }), row({ id: "second", typedBy: "Aino" }), row({ id: "his", typedBy: "Eero" })];
    const out = html(loans, withAccounts(report(all, { maybeTwice: [others] }), [{ id: "acc" }]));
    expect(out).toContain("Jos velka on sama, Aino tai Eero voi poistaa tallennetun lainan kohdassa Asetukset &gt; Lainat, niin se lasketaan kerran.");
    expect(out).not.toContain("Liitä");
    expect(out).not.toContain("<a ");
  });
});
