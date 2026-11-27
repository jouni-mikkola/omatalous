import type { LoanRow, LoansReport } from "@banking/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "./fixed-clock.ts";
import { Figure } from "../src/components/Figure.tsx";
import { hasWhatIf } from "../src/components/loans/LoanDrill.tsx";
import { percent } from "../src/format.ts";
import { PageAddressContext } from "../src/page-address.ts";
import { section as balances } from "../src/pages/reports/sections/Balances.tsx";
import { section as loans } from "../src/pages/reports/sections/Loans.tsx";
import type { ReportContext, ReportSection } from "../src/pages/reports/types.ts";
import { loanHash } from "../src/routes.ts";
import { DRILL_PARAM, tableId, writeTableState } from "../src/table-state.ts";
import { t } from "../src/text.ts";

const day = "2026-10-11";
/** A mortgage with every figure known. Made up, like every loan here. */
const row = (over: Partial<LoanRow> = {}): LoanRow =>
  ({
    id: "home", name: "Kodin laina", lender: "Esimerkkipankki", kind: "mortgage", accountType: null, linkedAccount: null,
    balance: { cents: 12_000_000, unknown: null }, balanceDate: day, rateBp: 325, reference: "euribor_12", repayment: "annuity",
    payment: { cents: 100_000, interestCents: 32_500, amortisationCents: 67_500, intervalMonths: 1, date: null, unknown: null },
    interest: { cents: 380_000, unknown: null }, cost: null, payoff: { date: "2040-02-01", unknown: null, never: false }, scenarios: [],
    ...over,
  }) as LoanRow;
/** No loan the path can move forward: no chart. */
const NO_PATH: NonNullable<LoansReport["path"]> = { days: [day], balanceCents: [0], interestCents: [0], tops: [0], payoff: null, moves: [] };
const report = (rows: LoanRow[], over: Partial<LoansReport> = {}) => ({
  day, saved: rows.length, loans: rows, unsaved: [], total: { cents: 12_000_000, unknown: [] }, totalKnown: true, interest: { cents: 380_000, unknown: [] }, interestKnown: true,
  withoutRate: 0, cost12: { cents: 380_000, interestCents: 380_000, feeCents: 0 }, plan: null, consolidation: null, payments: { monthlyCents: 100_000, counted: 1, unknown: 0, bullets: 0 }, monthly: { cents: 100_000, unknown: 0 }, path: NO_PATH, extra: [], maybeTwice: [], overdraftTwice: [], ended: [], ...over,
});
const balanceData = {
  months: ["2026-09", "2026-10"], total: [100_000, 120_000], monthChange: [null, 20_000], missing: [], accountsLessDebt: [null, -11_880_000], lowest: null, peak: null,
  daily: { from: "2026-09-30", cents: [100_000, 120_000] }, change: { from: "2026-09-30", to: "2026-10-01", cents: 20_000 }, holdings: { accounts: [], cards: [], loans: [], debtCents: 0, unsavedLoans: null, netCents: null },
  accounts: [{ accountId: "a", name: "Käyttötili", asOf: day, values: [100_000, 120_000], changeCents: 20_000 }], debt: { day, cents: 12_000_000, savedCents: 12_000_000 },
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
/** The section as the words a reader meets: tags gone, one space between. */
const words = (out: string) => out.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
/** The figures of the open drills: label and value of each, in order. */
const figuresOf = (out: string) => [...out.matchAll(/<div><dt>([^<]*)<\/dt><dd[^>]*>([^<]*)/g)].map((m) => `${m[1]} ${m[2]}`);
/** The names of the table's rows, in order. */
const namesOf = (out: string) => [...out.matchAll(/<span class="loan-name">([^<]*)<\/span>/g)].map((m) => m[1]);
/** The section with the drill of one debt open, as a reader who pressed its chevron (or followed a link to it) sees it. */
const opened = (key: string, ctx: ReportContext) => {
  const search = { [DRILL_PARAM]: writeTableState(undefined, tableId(t("rpt.ln_caption")), key) };
  return html0(createElement(PageAddressContext.Provider, { value: { search, change: () => {} } }, createElement(loans.Component, { ctx })));
};
/** A connected card with 1 240 € used. */
const card = (over: Partial<LoanRow> = {}) =>
  row({ id: "account:c1", name: "Esimerkkikortti Gold", lender: null, kind: "card", accountType: "credit_card", balance: { cents: 124_000, unknown: "repayment" }, rateBp: null, reference: null, repayment: null, payment: { cents: null, interestCents: null, amortisationCents: null, intervalMonths: null, date: null, unknown: "repayment" }, interest: { cents: null, unknown: "rate" }, payoff: { date: null, unknown: "repayment", never: false }, ...over });

describe("Raportit: Lainat", () => {
  it("draws the way to the payoff under its question, with what a rise of the rate adds, and no chart where a debt cannot be projected", () => {
    const path: NonNullable<LoansReport["path"]> = {
      days: ["2026-10-11", "2026-11-11", "2026-12-11"], balanceCents: [12_000_000, 6_000_000, 0], interestCents: [300_000, 100_000, 0], tops: [12_300_000, 6_100_000, 0],
      payoff: "2026-12-01", moves: [{ shiftBp: 100, tops: [12_400_000, 6_150_000, 0], payoff: "2026-12-01", extraCents: 100_000 }],
    };
    const out = html(loans, context(report([row()], { path })));
    expect(out).toContain("Velkapolku");
    expect(out).toContain("Viimeinen laina on maksettu joulukuussa 2026. Velkaa on nyt 120 000 €, ja korkoa tulee sen päälle vielä 3 000 €. Jos viitekorko nousee prosenttiyksikön, korkoa tulee arviolta 1 000 € enemmän.");
    expect(out).not.toContain("ei ole kuvassa");
    expect(html(loans, context(report([row()], { path: null })))).not.toContain("Velkapolku");
    // no extra payment given: no choice of one
    expect(out).not.toContain("Milloin velaton");
  });

  it("offers the extra monthly payments under Milloin velaton, opens on the middle one and tells the month, the months earlier and the saving", () => {
    const path: NonNullable<LoansReport["path"]> = {
      days: ["2026-10-11", "2026-11-11", "2026-12-11"], balanceCents: [12_000_000, 6_000_000, 0], interestCents: [300_000, 100_000, 0], tops: [12_300_000, 6_100_000, 0],
      payoff: "2026-12-01", moves: [],
    };
    const scenario = (extraCents: number, debtFreeDate: string, monthsEarlier: number, savedCents: number): LoansReport["extra"][number] => ({
      extraCents, debtFreeDate, monthsEarlier, savedCents, bufferCents: 0, bufferFullDate: null, owedCents: [12_000_000, 3_000_000, 0],
    });
    const extra = [scenario(5_000, "2026-12-01", 1, 10_000), scenario(10_000, "2026-11-01", 2, 25_000), scenario(20_000, "2026-11-01", 3, 40_000)];
    const out = html(loans, context(report([row()], { path, extra })));
    expect(out).toContain("Milloin velaton");
    expect(words(out)).toContain("100 € lisää kuussa: viimeinen laina on maksettu marraskuussa 2026. Se on 2 kuukautta aiemmin. Korkoja ja kuluja jää 250 € vähemmän.");
    expect(words(out)).toContain("Ei lisää 50 € lisää 100 € lisää 200 € lisää");
  });

  it("tells a rate with two decimals through the one percent formatter", () => {
    expect(percent(0.0325, 2).replace(/ /g, " ")).toBe("3,25 %");
    expect(percent(-0.005, 2).replace(/ /g, " ")).toBe("−0,50 %");
    expect(percent(0.254).replace(/ /g, " ")).toBe("25 %");
  });

  it("lists each debt with its balance, its core rate, the class word of a dear one and its cost of 12 months", () => {
    const cost = (rateMilli: number, costClass: "cheap" | "dear" | "very_dear", cents: number) => ({ rateMilli, costClass, next12: { cents, interestCents: cents, feeCents: 0 }, leftCents: cents, feePerPaymentCents: 0, unknown: null });
    const out = words(html(loans, context(report([row({ id: "a", name: "Kallis laina", balance: { cents: 500_000, unknown: null }, cost: cost(9_400, "dear", 40_000) }), row({ id: "b", name: "Halpa laina", cost: cost(3_300, "cheap", 380_000) }), row({ id: "c", name: "Kortti", cost: cost(31_000, "very_dear", 90_000) })]))));
    expect(out).toContain("Velka Saldo Todellinen korko Korot ja kulut 12 kk");
    expect(out).toMatch(/Kallis laina .*5 000 € 9,40 % Kallis 400 €/);
    expect(out).toContain("3,30 % 3 800 €");
    expect(out).toContain("Erittäin kallis");
    // a cheap debt carries no word, and no other word is told
    expect(out).not.toMatch(/Edullinen|Maksuton|korkea korko/);
  });

  it("a balance dated ahead has no total, a dash and never a zero", () => {
    const ahead = report([row()], { total: { cents: 0, unknown: [{ loanId: "home", unknown: "before_balance_date", counted: false }] }, totalKnown: false });
    const out = html(loans, context(ahead));
    expect(words(out)).toContain("Velat yhteensä –");
    expect(out).not.toContain("puuttuu");
  });

  it("the cost has no column while no debt has one, with the one link to Tarkistettavat in the head, never the known part", () => {
    // the debt lacking its terms is an unsaved one Tarkistettavat still asks of
    const unsaved = [{ debtId: "proposal:a", name: "Esimerkkirahoitus", monthlyCents: 10_000, card: false }];
    const out = html(loans, context(report([row({ cost: null })], { cost12: { cents: null, interestCents: null, feeCents: null }, unsaved })));
    expect(out).toContain('<a href="#/review?item=loan-terms">Täydennä lainat</a>');
    expect(out.split("Täydennä lainat").length - 1).toBe(1);
    expect(words(out)).toMatch(/Täydennä lainat .*Velat yhteensä, tiedossa 120 000 €/);
    expect(out).not.toContain("Korot ja kulut 12 kk");
    expect(out).not.toContain("3 800");
    // the terms known: the figure and no link
    const known = html(loans, context(report([row()])));
    expect(known).not.toContain("loan-terms");
    expect(words(known)).toContain("Velat yhteensä 120 000 € 3 800 €");
  });

  it("a bullet has no payment to tell, in its drill, after a move of the rate or in the payments of a month", () => {
    const bullet = row({ repayment: "bullet", payment: { cents: null, interestCents: null, amortisationCents: null, intervalMonths: null, date: null, unknown: null }, scenarios: [{ shiftBp: 100, movedBp: 100, rateBp: 425, paymentCents: null, interestCents: 510_000, unknown: null }] });
    const out = opened("home", context(report([bullet], { payments: { monthlyCents: 0, counted: 0, unknown: 0, bullets: 1 }, monthly: { cents: null, unknown: 0 } })));
    expect(out).toContain("<dd>Kertalyhennys<small>maksat kerralla lopussa</small></dd>");
    expect(out).toContain("Jos viitekorko nousee prosenttiyksikön: korot 12 kuukaudessa 5 100 €.");
    expect(out).toContain(`${tile("Maksut kuussa", "ei maksuja")}`);
    expect(out).not.toContain("korot eivät ole mukana");
  });

  it("a fall shorter than a point is told as far as it goes in the drill, and a sum nothing is known of is not zero", () => {
    const near = row({ scenarios: [{ shiftBp: -100, movedBp: -50, rateBp: 275, paymentCents: 97_000, interestCents: 320_000, unknown: null }] });
    const out = opened("home", context(report([near], { interestKnown: false, payments: { monthlyCents: 0, counted: 0, unknown: 1, bullets: 0 }, monthly: { cents: null, unknown: 1 } })));
    expect(out).toContain("Jos viitekorko laskee 0,5 prosenttiyksikköä: maksu 970,00 €, korot 12 kuukaudessa 3 200 €.");
    expect(out).toContain(`${tile("Maksut kuussa", "–")}`);
    expect(out).not.toContain("ei tiedossa");
    expect(out).not.toContain("puuttuu");
  });

  it("a debt that may be there twice is named with what fixes it, and nothing tells the household to link", () => {
    const twice = report([row()], { maybeTwice: [{ loans: [{ id: "home", name: "Kodin laina" }, { id: "car", name: "Autolaina" }], accounts: [{ id: "acc", name: "Asuntolaina" }] }] });
    const out = html(loans, context(twice));
    expect(out).toContain("Sama velka voi olla summassa kahdesti: tallennettu laina Kodin laina tai Autolaina ja yhdistetty tili Asuntolaina.");
    expect(out).toContain("Jos kyse on samasta velasta, poista tallennettu laina kohdassa Varat ja velat &gt; Lainat, niin laskemme sen vain kerran.");
    expect(out.toLowerCase()).not.toContain("liitä");
    // Lainat is the one place that says it
    expect(html(balances, context(twice))).not.toContain("kahdesti");
  });

  it("two connected accounts beside one saved loan are told in one sentence that lists both", () => {
    const accounts = [{ id: "la", name: "Asuntolaina" }, { id: "la2", name: "Asuntolaina" }, { id: "la3", name: "Autolaina" }];
    const pair = (n: number) => report([row()], { maybeTwice: [{ loans: [{ id: "home", name: "Kodin laina" }], accounts: accounts.slice(0, n) }] });
    const out = html(loans, context(pair(2)));
    expect(out.split("Sama velka voi olla").length - 1).toBe(1);
    expect(out).toContain("Sama velka voi olla summassa kahdesti: tallennettu laina Kodin laina ja yhdistetyt tilit Asuntolaina ja Asuntolaina. Jos kyse on samasta velasta,");
    expect(html(loans, context(pair(3)))).toContain("tallennettu laina Kodin laina ja yhdistetyt tilit Asuntolaina, Asuntolaina ja Autolaina.");
  });

  it("an overdraft beside a saved credit line is told in Lainat, by the name the net figure has at the head of the page", () => {
    const sentence = "Jos tallentamasi laina näkyy myös pankin tiedoissa, se on luvussa Varat velkojen jälkeen kahdesti. Silloin oikea luku on lainan verran suurempi.";
    const over = report([row()], { overdraftTwice: [{ loans: [{ id: "cl", name: "Tililuotto" }], accounts: [{ id: "a", name: "Käyttötili" }] }] });
    expect(html(loans, context(over))).toContain(`<li class="notice" data-tone="warning">${sentence}</li>`);
    expect(html(balances, context(over))).not.toContain("kahdesti");
    // the debt total holds it once: nothing says "summassa", and Saldot does not send the reader to Lainat for it
    expect(html(loans, context(over)) + html(balances, context(over))).not.toMatch(/summassa|katso Lainat/);
    // a range that ends before today shows no such figure, and no sentence about it
    const earlier = html(loans, context(over, "own", balanceData, "2026-11"));
    expect(earlier).not.toContain("Varat velkojen jälkeen");
    expect(earlier).toContain("Velat yhteensä");
    const two = report([row()], { overdraftTwice: [{ loans: [{ id: "cl", name: "Tililuotto" }], accounts: [{ id: "a", name: "Käyttötili" }, { id: "b", name: "Yhteinen tili" }] }] });
    // two accounts below zero are still one figure, so one sentence
    expect(html(loans, context(two)).split("se on luvussa").length - 1).toBe(1);
  });

  it("a move of the rate names the payment only when it has one, and a move with no figure has no line", () => {
    const typed = { cents: 10_000, interestCents: null, amortisationCents: null, intervalMonths: 1, date: null, unknown: "repayment" } as const;
    const move = (shiftBp: number, paymentCents: number | null, interestCents: number | null) => ({ shiftBp, movedBp: shiftBp, rateBp: 700 + shiftBp, paymentCents, interestCents, unknown: null });
    const line = opened("home", context(report([row({ payment: typed, scenarios: [move(-100, null, 18_000), move(100, null, 24_000)] })])));
    expect(line).toContain('<p class="loan-scenario">Jos viitekorko laskee prosenttiyksikön: korot 12 kuukaudessa 180 €. Jos viitekorko nousee prosenttiyksikön: korot 12 kuukaudessa 240 €.</p>');
    const none = opened("home", context(report([row({ scenarios: [move(-100, null, null), move(100, null, null)] })])));
    expect(none).not.toContain("loan-scenario");
    expect(none).not.toContain("Jos viitekorko");
    const one = opened("home", context(report([row({ scenarios: [move(-100, null, null), move(100, 105_000, 500_000)] })])));
    expect(one).toContain('<p class="loan-scenario">Jos viitekorko nousee prosenttiyksikön: maksu 1 050,00 €, korot 12 kuukaudessa 5 000 €.</p>');
  });

  it("the plan line is above the list when the server has a plan, and there is none while it has not", () => {
    const plan = { debtFreeDate: "2029-03-01", baseDebtFreeDate: "2030-01-01", savedCents: 41_000, bufferCents: 0, bufferFullDate: null, snowballExtraCents: 0, debts: [{ id: "home", order: 1, endDate: "2029-03-01", baseEndDate: "2029-03-01" }] };
    const out = html(loans, context(report([row()], { plan })));
    expect(words(out)).toContain("Velaton 3/2029 · säästät 410 €");
    expect(out.indexOf("loan-plan")).toBeLessThan(out.indexOf('class="rt-wrap"'));
    expect(html(loans, context(report([row()])))).not.toContain("loan-plan");
  });

  it("the what-if is for the viewer's own whole saved loans only: no account row, another member's loan or part of a shared one has it", () => {
    expect(hasWhatIf(row())).toBe(true);
    expect(hasWhatIf(card())).toBe(false);
    expect(hasWhatIf(row({ id: "theirs", typedBy: "Aino" }))).toBe(false);
    expect(hasWhatIf(row({ id: "half", part: { from: 0, to: 2, of: 5 } }))).toBe(false);
  });

  it("a figure nothing is known of is a dash in the totals, and no sentence says which loans a total leaves out for it", () => {
    const later = { cents: 0, unknown: [{ loanId: "home", unknown: "before_balance_date", counted: false }] } as const;
    const out = html(loans, context(report([row()], { interest: later, interestKnown: false, payments: { monthlyCents: 0, counted: 0, unknown: 1, bullets: 0 }, monthly: { cents: null, unknown: 1 } })));
    expect(out).toContain(`${tile("Maksut kuussa", "–")}`);
    expect(html(loans, context(report([row()], { withoutRate: 2 })))).not.toContain("puuttuu");
  });

  it("the net figure stands at the head of the page alone: neither section tells the accounts less the debts", () => {
    const saldot = html(balances, context(report([row()])));
    const own = html(loans, context(report([row()]))) + saldot;
    expect(own).not.toMatch(/Tilit miinus velat|Varat velkojen jälkeen|Tallennetut lainat|Nettovarallisuus|omasi/);
    // the totals of Lainat are the payments of a month alone
    expect(own.split('<div class="k">').length - 1).toBe(1);
    // how far the line of the chart moved is said under the chart's heading
    expect(words(saldot)).toMatch(/Saldojen kehitys \+200 € 30\.9\. jälkeen/);
    expect(words(html(balances, context(report([row()]), "own", { ...balanceData, change: { ...balanceData.change, cents: 99 } })))).not.toContain("jälkeen");
  });

  it("lists a loan and a card nobody saved with the monthly payment and no balance, and shows the section with no saved loan", () => {
    const unsaved = [{ debtId: "proposal:a", name: "Esimerkkirahoitus", monthlyCents: 10_000, card: false }, { debtId: "card_bill:b", name: "Esimerkkikauppa", monthlyCents: 20_000, card: true }];
    const data = report([], { unsaved, payments: { monthlyCents: 0, counted: 0, unknown: 0, bullets: 0 } });
    expect(loans.visible!(context(data))).toBe(true);
    expect(loans.visible!(context(report([])))).toBe(false);
    const out = html(loans, context(data));
    expect(out).toContain("Esimerkkirahoitus");
    expect(out).toContain("Esimerkkikauppa");
    expect(out).toContain("Luottokortti");
    expect(out.match(/saldo puuttuu/g)).toHaveLength(2);
    expect(out).toContain('<small class="loan-about">100,00 €/kk</small>');
    expect(out).toContain('<small class="loan-about">Luottokortti · 200,00 €/kk</small>');
    // nothing is saved, so there is no total and no row to open
    expect(out).not.toContain("rt-total");
    expect(out).not.toContain("data-drill");
    // no total of a debt nobody told: the tiles are of the saved loans
    expect(out).not.toContain("tiedossa");
  });

  it("shows a dash, never 0, for an unsaved debt with no monthly figure", () => {
    const unsaved = [{ debtId: "proposal:a", name: "Esimerkkierä", monthlyCents: null, card: false }];
    const out = html(loans, context(report([], { unsaved, payments: { monthlyCents: 0, counted: 0, unknown: 0, bullets: 0 } })));
    expect(out).not.toContain("loan-about");
    expect(out).not.toContain("/kk");
    expect(out).toContain("saldo puuttuu");
  });

  it("adds the payments the unsaved rows tell to the payments of a month, and counts the debts that tell none", () => {
    const unsaved = [{ debtId: "proposal:a", name: "Esimerkkirahoitus", monthlyCents: 10_000, card: false }, { debtId: "proposal:b", name: "Esimerkkierä", monthlyCents: null, card: false }];
    const known = { monthlyCents: 0, counted: 0, unknown: 1, bullets: 0 };
    // 1 382,24 € known and one debt with no figure: the sum and its count, never the sum alone or a dash
    const some = html(loans, context(report([row()], { unsaved, payments: known, monthly: { cents: 138_224, unknown: 2 } })));
    expect(some).toContain(`${tile("Maksut kuussa", "1 382 € + 2 ei tiedossa")}`);
    // every debt tells its payment: the sum alone
    expect(html(loans, context(report([row()], { monthly: { cents: 138_224, unknown: 0 } })))).toContain(`${tile("Maksut kuussa", "1 382 €")}`);
    // none known: a dash
    expect(html(loans, context(report([row()], { unsaved, monthly: { cents: null, unknown: 2 } })))).toContain(`${tile("Maksut kuussa", "–")}`);
  });

  it("names the total of saved loans as the known one while a debt has no balance", () => {
    const unsaved = [{ debtId: "proposal:a", name: "Esimerkkirahoitus", monthlyCents: 10_000, card: false }];
    expect(words(html(loans, context(report([row()], { unsaved }))))).toContain("Velat yhteensä, tiedossa 120 000 €");
    expect(html(loans, context(report([row()])))).not.toContain("tiedossa");
  });

  it("Saldot leaves the debts without a balance to Lainat, which lists them", () => {
    const unsaved = [{ debtId: "proposal:a", name: "Esimerkkirahoitus", monthlyCents: 10_000, card: false }];
    const holdings = { ...balanceData.holdings, unsavedLoans: { count: 1, names: ["Esimerkkirahoitus"], paymentCents: 10_000, rows: unsaved } };
    const out = html(balances, context(report([], { unsaved }), "own", { ...balanceData, holdings }));
    expect(out).not.toContain("saldo puuttuu");
  });

  it("the household view has no sentence about another member's saved loan", () => {
    expect(html(loans, context(report([row()]), "household"))).not.toContain("Toisen lisäämä");
  });

  it("a loan another member typed in says who after the kind, and the viewer's own says nothing; a part is the labelled value Osuutesi", () => {
    const theirs = row({ id: "theirs", part: { from: 3, to: 5, of: 5 }, typedBy: "Aino" });
    const out = opened("theirs", context(report([row(), theirs])));
    expect(out).toContain('<span class="loan-name">Kodin laina</span><small class="loan-about">Asuntolaina · Esimerkkipankki · Lisännyt Aino</small>');
    expect(out).toContain('<span class="loan-name">Kodin laina</span><small class="loan-about">Asuntolaina · Esimerkkipankki</small>');
    expect(out.split("Lisännyt").length - 1).toBe(1);
    expect(out).toContain(figure("Osuutesi", "40 %"));
    expect(out.split("Osuutesi").length - 1).toBe(1);
    expect(out).not.toContain("osuutesi");
    // the loan no what-if opens for tells its known rate and reference in its drill
    expect(out).toContain("<dt>Korko</dt><dd>3,25 %<small>12 kuukauden Euribor</small></dd>");
  });

  it("Täydennä lainat opens the drill of the saved loan the viewer can change when its rate is what the cost waits for, and Tarkistettavat otherwise", () => {
    const noRate = { rateBp: null, reference: null, interest: { cents: null, unknown: "rate" }, cost: { rateMilli: null, costClass: null, next12: null, leftCents: null, feePerPaymentCents: null, unknown: "rate" } } as const;
    const unknownCost = { cost12: { cents: null, interestCents: null, feeCents: null } };
    const link = (out: string) => [...out.matchAll(/<a href="([^"]*)">Täydennä lainat<\/a>/g)].map((m) => m[1]!.replaceAll("&amp;", "&"));
    // a rate-only saved loan of the viewer: its own drill
    expect(link(html(loans, context(report([row(noRate)], unknownCost))))).toEqual([loanHash("home")]);
    // an unsaved debt is a cause too: the list of debts asks for all of it
    const unsaved = [{ debtId: "proposal:a", name: "Esimerkkirahoitus", monthlyCents: 10_000, card: false }];
    expect(link(html(loans, context(report([row(noRate)], { ...unknownCost, unsaved }))))).toEqual(["#/review?item=loan-terms"]);
    // another member's loan or a connected account the viewer cannot change has no drill of theirs to open, and nothing to ask
    expect(link(html(loans, context(report([row({ ...noRate, typedBy: "Aino" })], unknownCost))))).toEqual([]);
    expect(link(html(loans, context(report([row({ ...noRate, id: "account:acc-1" })], unknownCost))))).toEqual([]);
  });

  it("Täydennä lainat opens the drill of a rate-only own loan when every unsaved debt is one Tarkistettavat no longer asks of", () => {
    const noRate = { rateBp: null, reference: null, interest: { cents: null, unknown: "rate" }, cost: { rateMilli: null, costClass: null, next12: null, leftCents: null, feePerPaymentCents: null, unknown: "rate" } } as const;
    const unknownCost = { cost12: { cents: null, interestCents: null, feeCents: null } };
    const link = (out: string) => [...out.matchAll(/<a href="([^"]*)">Täydennä lainat<\/a>/g)].map((m) => m[1]!.replaceAll("&amp;", "&"));
    const asked = [
      { debtId: "proposal:a", name: "Esimerkkirahoitus", monthlyCents: 10_000, card: false, asked: true as const },
      { debtId: "card_bill:b", name: "Esimerkkikortti", monthlyCents: 20_000, card: true, asked: true as const },
    ];
    expect(link(html(loans, context(report([row(noRate)], { ...unknownCost, unsaved: asked }))))).toEqual([loanHash("home")]);
    // one debt still asked of keeps the link on the list that asks it
    const open = [...asked, { debtId: "proposal:c", name: "Toinenrahoitus", monthlyCents: 5_000, card: false }];
    expect(link(html(loans, context(report([row(noRate)], { ...unknownCost, unsaved: open }))))).toEqual(["#/review?item=loan-terms"]);
  });

  it("Täydennä lainat has no link when nothing in Tarkistettavat or in an own loan's form is left to answer", () => {
    const noRate = { rateBp: null, reference: null, interest: { cents: null, unknown: "rate" }, cost: { rateMilli: null, costClass: null, next12: null, leftCents: null, feePerPaymentCents: null, unknown: "rate" } } as const;
    const unknownCost = { cost12: { cents: null, interestCents: null, feeCents: null } };
    const link = (out: string) => [...out.matchAll(/<a href="([^"]*)">Täydennä lainat<\/a>/g)].map((m) => m[1]!.replaceAll("&amp;", "&"));
    const asked = [{ debtId: "proposal:a", name: "Esimerkkirahoitus", monthlyCents: 10_000, card: false, asked: true as const }];
    // (a) every unsaved debt asked of already and no own loan with an unknown cost: no link, and no column of dashes
    const a = html(loans, context(report([row()], { ...unknownCost, unsaved: asked })));
    expect(link(a)).toEqual([]);
    expect(a).not.toContain("Korot ja kulut 12 kk");
    // (b) an own loan whose cost is unknown by its repayment: the link opens its drill
    const repayment = { cost: { rateMilli: null, costClass: null, next12: null, leftCents: null, feePerPaymentCents: null, unknown: "repayment" } } as const;
    expect(link(html(loans, context(report([row(repayment)], { ...unknownCost, unsaved: asked }))))).toEqual([loanHash("home")]);
    // (c) only a member's loan with an unknown cost: no drill of the viewer's and nothing to ask
    const member = html(loans, context(report([row({ ...noRate, typedBy: "Aino" })], { ...unknownCost, unsaved: asked })));
    expect(link(member)).toEqual([]);
    expect(member).not.toContain("Täydennä");
    // (d) a connected card owing at an unknown rate: Tarkistettavat keeps asking its rate, so the link opens the list
    const cardRate = { cost: { rateMilli: null, costClass: null, next12: null, leftCents: null, feePerPaymentCents: null, unknown: "rate" } } as const;
    expect(link(html(loans, context(report([card(cardRate)], { ...unknownCost, unsaved: asked }))))).toEqual(["#/review?item=loan-terms"]);
  });

  it("the kind is left out under a name that is the kind", () => {
    expect(html(loans, context(report([row({ name: "Asuntolaina" })])))).toContain('<span class="loan-name">Asuntolaina</span><small class="loan-about">Esimerkkipankki</small>');
    expect(html(loans, context(report([row({ name: "asuntolaina", lender: null })])))).not.toContain("loan-about");
    expect(html(loans, context(report([row({ name: "Asuntolaina 2" })])))).toContain('<span class="loan-name">Asuntolaina 2</span><small class="loan-about">Asuntolaina · Esimerkkipankki</small>');
  });

  it("a loan with a figure not told has a dash and no link: Tarkistettavat asks for what is missing", () => {
    const untold = { rateBp: null, reference: null, interest: { cents: null, unknown: "rate" }, cost: { rateMilli: null, costClass: null, next12: null, leftCents: null, feePerPaymentCents: null, unknown: "rate" } } as const;
    const mine = html(loans, context(report([row(untold)])));
    expect(mine).toContain('<span class="loan-unknown">–</span>');
    expect(mine).not.toContain("Täydennä");
    // the drill says what the cost waits for, in words, and links nowhere
    const drill = opened("home", context(report([row({ ...untold, typedBy: "Aino" })])));
    expect(drill).toContain(">Korko puuttuu</p>");
    expect(drill).not.toContain("Täydennä");
  });

  it("lists the debts by Todellinen korko, highest first, and the debt with no cost last", () => {
    const cost = (rateMilli: number, costClass: "cheap" | "dear") => ({ rateMilli, costClass, next12: { cents: 1000, interestCents: 1000, feeCents: 0 }, leftCents: 1000, feePerPaymentCents: 0, unknown: null });
    const out = html(loans, context(report([card(), row({ id: "low", name: "Matala", rateBp: 325, cost: cost(3_300, "cheap") }), row({ id: "high", name: "Korkea", rateBp: 900, cost: cost(9_400, "dear") })])));
    expect(namesOf(out)).toEqual(["Korkea", "Matala", "Esimerkkikortti Gold"]);
  });

  it("a connected card has its used credit and, when the account has a limit, the limit; none of a loan's terms and no link", () => {
    const open = (data: unknown, accounts: object[]) => opened("account:c1", { ...context(data), meta: { today: day, accounts } } as unknown as ReportContext);
    const limited = open(report([card()]), [{ id: "c1", creditLimitCents: 500_000 }]);
    expect(figuresOf(limited)).toEqual(["Luottoraja 5 000,00 €"]);
    // the balance is the used credit, in the column of the balance, and the drill is what comes after the row
    expect(words(limited)).toContain("Esimerkkikortti Gold 1 240 €");
    const list = limited.slice(limited.indexOf('<tr class="rt-detail"'));
    for (const word of ["Maksu", "Korot seuraavan 12 kuukauden aikana (arvio)", "Viimeinen maksupäivä", "Yhdistetty tili", "jäljellä", "Täydennä", "ei tiedossa"]) expect(list, word).not.toContain(word);
    expect(namesOf(limited)).toEqual(["Esimerkkikortti Gold"]);
    // no limit told, or one of nothing: the used credit alone
    expect(figuresOf(open(report([card()]), [{ id: "c1", creditLimitCents: null }]))).toEqual([]);
    expect(figuresOf(open(report([card()]), [{ id: "c1", creditLimitCents: 0 }]))).toEqual([]);
    // the limit is the account's: a card the viewer has a part of shows the part used and its share, no limit beside it
    const half = open(report([card({ part: { from: 0, to: 2, of: 5 } })]), [{ id: "c1", creditLimitCents: 500_000 }]);
    expect(figuresOf(half)).toEqual(["Osuutesi 40 %"]);
    // a saved loan of the kind card is a loan with the terms of one
    expect(figuresOf(opened("home", withAccounts(report([row({ kind: "card", name: "Kaupan kortti" })]), [{ id: "c1", creditLimitCents: 500_000 }]))).map((f) => f.split(" ")[0])).toEqual(["Maksu", "Korko", "Lyhennys"]);
  });

  it("a debt that may be there twice offers no link for a loan another member typed in, and says who can remove it", () => {
    const beside = { loans: [{ id: "home", name: "Kodin laina" }, { id: "theirs", name: "Autolaina" }], accounts: [{ id: "acc", name: "Lainatili" }] };
    const rows = [row(), row({ id: "theirs", name: "Autolaina", typedBy: "Aino" })];
    // the viewer's own loan links to the viewer's own account, hers does not
    const linkable = html(loans, withAccounts(report(rows, { maybeTwice: [beside] }), [{ id: "acc" }]));
    expect(linkable).toContain("Liitä Kodin laina tiliin Lainatili</a>");
    expect(linkable).not.toContain("Liitä Autolaina");
    expect(linkable).not.toMatch(/href="[^"]*theirs/);
    // a set with a loan of the viewer's own and no account to link to: the viewer removes their own, as before
    expect(html(loans, withAccounts(report(rows, { maybeTwice: [beside] }), []))).toContain("Jos kyse on samasta velasta, poista tallennettu laina kohdassa Varat ja velat &gt; Lainat, niin laskemme sen vain kerran.");
    // every saved loan of the set is another member's: nothing to link though the account is the viewer's own, and the typists are named once each
    const others = { ...beside, loans: [{ id: "theirs", name: "Autolaina" }, { id: "second", name: "Remonttilaina" }, { id: "his", name: "Venelaina" }] };
    const all = [row({ id: "theirs", typedBy: "Aino" }), row({ id: "second", typedBy: "Aino" }), row({ id: "his", typedBy: "Eero" })];
    const out = html(loans, withAccounts(report(all, { maybeTwice: [others] }), [{ id: "acc" }]));
    expect(out).toContain("Jos kyse on samasta velasta, Aino tai Eero voi poistaa tallennetun lainan kohdassa Varat ja velat &gt; Lainat, niin laskemme sen vain kerran.");
    expect(out).not.toContain("Liitä");
    expect(out).not.toContain("<a ");
  });
});
