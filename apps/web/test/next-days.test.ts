import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NextDays } from "../src/components/NextDays.tsx";
import { type Ahead, figures, incoming, payments, payNote, paymentsCaption, shortIsEstimate, warning, windowLine } from "../src/components/next-days.ts";
import { SETTINGS_ANCHOR } from "../src/routes.ts";
import { steady, varies } from "./pay-fixture.ts";

type Row = Ahead["rows"][number];
type Balance = NonNullable<Ahead["balance"]>;

/** The text as a reader sees it: the spaces inside a sum are plain ones. */
const plain = (s: string) => s.replace(/[  ]/g, " ").replace(/−/g, "-");

const row = (over: Partial<Row>): Row => ({ date: "2026-10-15", name: "Sähköyhtiö Esimerkki", category: "utilities", cents: -4_500, source: "recurring", ...over });
const BILLS = [row({}), row({ date: "2026-10-20", name: "Esimerkkivakuutus", cents: -14_230 }), row({ date: "2026-10-21", name: "Vuokra Esimerkki", cents: -105_000, source: "expected" })];
const OTHER_PAY = row({ date: "2026-10-14", name: "Pieni Esimerkki Oy", category: "salary", cents: 80_000, source: "income", pay: steady(80_000) });

const balance = (over: Partial<Balance> = {}): Balance => ({ startCents: 200_000, counts: "all", accounts: 1, balanceAt: "2026-10-12T06:00:00Z", freeCents: 76_270, shortCents: 0, shortOn: null, ...over });

/** A payday window as core gives it: Monday 12.10., the pay on Friday 23.10., the window to Thursday 22.10. */
function ahead(over: Partial<Ahead> = {}, rows: Row[] = BILLS): Ahead {
  const sum = (source: Row["source"]) => rows.filter((r) => r.source === source).reduce((s, r) => s + Math.abs(r.cents ?? 0), 0);
  const dueCents = sum("recurring") + sum("expected");
  return {
    from: "2026-10-12",
    to: "2026-10-22",
    days: 10,
    reason: "payday",
    payday: { date: "2026-10-23", name: "Esimerkki Oy", pay: steady(300_000) },
    rows,
    upcoming: rows.filter((r) => r.cents! < 0),
    everydayPerDayCents: 3_849,
    totals: { recurringCents: sum("recurring"), typedCents: sum("expected"), cardCents: 0, transferCents: 0, dueCents, incomeCents: sum("income") },
    balance: balance({ freeCents: 200_000 - dueCents }),
    missing: null,
    ...over,
  };
}
const NONE: Partial<Ahead> = { reason: "none", payday: null, days: 30, to: "2026-11-11" };
const LATE: Partial<Ahead> = { reason: "late", payday: { date: "2026-10-09", name: "Esimerkki Oy", pay: steady(300_000) }, days: 30, to: "2026-11-11" };

const html = (a: Ahead) => plain(renderToStaticMarkup(createElement(NextDays, { ahead: a })));
/** The names of the rows of every table on the page, in order. */
const names = (out: string) => [...out.matchAll(/<td [^>]*title="([^"]+)"/g)].map((m) => m[1]);

describe("the line under the heading, by what the window waits for", () => {
  it("names the payday with its weekday", () => {
    expect(windowLine(ahead())).toBe("Palkkapäivään asti, pe 23.10.");
    expect(windowLine(ahead({ to: "2026-10-12", days: 0, payday: { date: "2026-10-13", name: "Esimerkki Oy", pay: steady(300_000) } }))).toBe("Palkkapäivään asti, ti 13.10.");
  });

  it("a pay whose day has gone by and that is not late yet: the line names the next pay's day, the second sentence the day the pay was expected, and its row keeps that day", () => {
    // core names such a pay for today and lets the window run on to the next pay, whose day it gives
    const behind = { date: "2026-10-12", expected: "2026-10-09", name: "Esimerkki Oy", pay: steady(300_000) };
    const waited = ahead({ to: "2026-11-05", days: 24, payday: { ...behind, next: "2026-11-06" } }, []);
    expect(windowLine(waited)).toBe("Palkkapäivään asti, pe 6.11. Palkka ei ole vielä tullut. Sen piti tulla pe 9.10.");
    expect(paymentsCaption(waited)).toBe("Erääntyvät maksut ennen palkkapäivää");
    // the pay the window waits for carries its sum for the door to its basis, where "≈" says what "noin" says here
    expect(incoming(waited).map((l) => ({ ...l, sum: plain(l.sum ?? ""), payday: plain(l.payday ?? "") }))).toEqual([{ day: "9.10.", name: "Esimerkki Oy", note: null, merchant: "Esimerkki Oy", cents: 300_000, estimate: true, sum: "noin 3 000 €", payday: "3 000 €" }]);
    // the next pay is another salary's and it is today: the window is today alone, and no day gone by is named as its end
    const today = ahead({ to: "2026-10-12", days: 0, payday: { ...behind, next: "2026-10-12" } }, []);
    expect(windowLine(today)).toBe("Palkkapäivään asti, ma 12.10. Palkka ei ole vielä tullut. Sen piti tulla pe 9.10.");
    // no pay to come within the days looked at: the 30 days, and the same second sentence
    const alone = ahead({ to: "2026-11-11", days: 30, payday: behind }, []);
    expect(windowLine(alone)).toBe("Seuraavat 30 päivää. Palkka ei ole vielä tullut. Sen piti tulla pe 9.10.");
    expect(paymentsCaption(alone)).toBe("Erääntyvät maksut seuraavan 30 päivän aikana");
    // near miss: the same pay due today has one day, and it is today
    const due = ahead({ to: "2026-10-12", days: 0, payday: { date: "2026-10-12", name: "Esimerkki Oy", pay: steady(300_000) } }, []);
    expect([windowLine(due), incoming(due)[0]!.day]).toEqual(["Palkkapäivään asti, ma 12.10.", "12.10."]);
  });

  it("a pay that is behind ends no window: the payment due tomorrow is listed and warned of, and the pay is still the last to arrive", () => {
    // core's answer on Wednesday 7.10.: the pay of Monday 5.10. has not come, the next one is on the 23rd, and a bill of 900 is due tomorrow
    const bill = row({ date: "2026-10-08", name: "Esimerkkivakuutus", cents: -90_000, source: "expected" });
    const pay = { date: "2026-10-07", expected: "2026-10-05", next: "2026-10-23", name: "Toinen Esimerkki Oy", pay: steady(210_000) };
    const out = html(ahead({ from: "2026-10-07", to: "2026-10-22", days: 15, payday: pay, balance: balance({ startCents: 40_000, freeCents: -50_000, shortCents: 50_000, shortOn: "2026-10-08" }) }, [bill]));
    expect(out).toContain("Palkkapäivään asti, pe 23.10. Palkka ei ole vielä tullut. Sen piti tulla ma 5.10.");
    expect(out).not.toContain("Ei erääntyviä maksuja");
    expect(out).toContain("Tilin kate ei riitä 8.10. erääntyvään maksuun. Puuttuu 500,00 €.");
    expect(names(out)).toEqual(["Esimerkkivakuutus", "Toinen Esimerkki Oy"]);
  });

  it("a late pay with another salary coming: the window is the days to that salary, and nothing warns of a payment after it", () => {
    // core's answer on 29.9.: the pay of 23.9. is late and the other salary comes on 5.10., so the window ends on 4.10.
    const rent = row({ date: "2026-10-02", name: "Vuokra Esimerkki", cents: -90_000 });
    const late = ahead({ from: "2026-09-29", to: "2026-10-04", days: 5, reason: "late", payday: { date: "2026-09-23", name: "Esimerkki Oy", pay: steady(278_000) }, balance: balance({ startCents: 150_000, freeCents: 60_000 }) }, [rent]);
    expect(windowLine(late)).toBe("Seuraavat 5 päivää. Palkka on myöhässä. Sen piti tulla ke 23.9.");
    const out = html(late);
    expect(out).not.toContain("Tilin kate ei riitä");
    expect(out).toContain('<caption class="sr-only">Erääntyvät maksut seuraavan 5 päivän aikana</caption>');
    expect(names(out)).toEqual(["Vuokra Esimerkki"]);
  });

  it("without a payday it is the 30 days from today", () => {
    expect(windowLine(ahead(NONE))).toBe("Seuraavat 30 päivää. Palkkapäivä ei ole tiedossa.");
  });

  it("with a late pay it says the pay is late and since when, and the late pay is no row to arrive", () => {
    expect(windowLine(ahead(LATE))).toBe("Seuraavat 30 päivää. Palkka on myöhässä. Sen piti tulla pe 9.10.");
    expect(incoming(ahead(LATE))).toEqual([]);
  });

  it("is the head of the three figures, in the left group of the block Erääntyvät maksut", () => {
    const out = html(ahead());
    expect(out).toContain('<section class="card st-block" aria-labelledby="ahead-h"><div class="card-head tb"><div class="card-name"><h2 id="ahead-h">Erääntyvät maksut</h2></div>');
    expect(out).toMatch(/<div class="card-datum">[−-][\d\s\u00a0]+ €<\/div><\/div>/);
    expect(out).toContain('<div class="st-cols st-cols-3"><div><h3 class="st-cap ahead-window">Palkkapäivään asti, pe 23.10.</h3><dl class="st-rows">');
    // the note, the line of days, the tables and the links are the right group, which takes two of the three columns
    expect(out.indexOf('<div class="st-wide"><p class="st-note ahead-estimates">')).toBeGreaterThan(out.indexOf("</dl>"));
    expect(out.endsWith('<a href="#/bills">Lisää lasku</a></p></div></div></section>')).toBe(true);
  });
});

describe("the three figures", () => {
  it("are the balance, what is due and what is free, each as core has it", () => {
    expect(figures(ahead())!.map((f) => `${f.label} ${f.cents}`)).toEqual(["Saldo 200000", "Erääntyvät maksut 123730", "Käytettävissä 76270"]);
    // nothing is added up on the page: three sums that do not add up are shown as they came
    const odd = ahead({ totals: { ...ahead().totals, dueCents: 111 }, balance: balance({ startCents: 333, freeCents: 555 }) });
    expect(figures(odd)!.map((f) => f.cents)).toEqual([333, 111, 555]);
    const out = html(ahead());
    expect(out).toContain('<dt class="st-name">Saldo</dt><dd class="st-num">2 000,00 €</dd>');
    expect(out).toContain('<dt class="st-name">Erääntyvät maksut</dt><dd class="st-num">1 237,30 €</dd>');
    expect(out).toContain('<div class="st-row st-total"><dt class="st-name">Käytettävissä</dt><dd class="st-num">762,70 €</dd>');
  });

  it("what is free keeps its minus when the payments exceed the balance", () => {
    expect(html(ahead({ balance: balance({ freeCents: -21_240, shortCents: 21_240, shortOn: "2026-10-21" }) }))).toContain('<dt class="st-name">Käytettävissä</dt><dd class="st-num">-212,40 €</dd>');
  });

  it("a balance older than a day says its day under Saldo", () => {
    const notes = (balanceAt: string | null) => figures(ahead({ balance: balance({ balanceAt }) }))![0]!.notes;
    expect(notes("2026-10-09T06:00:00Z")).toEqual(["Saldo päivältä 9.10.2026"]);
    expect(notes("2026-10-10T20:59:00Z")).toEqual(["Saldo päivältä 10.10.2026"]);
    // 21:00 UTC is already the 11th by the household's clock, so that balance is not old
    expect(notes("2026-10-10T21:00:00Z")).toEqual([]);
    // yesterday's balance and today's are not old, and a balance with no time says nothing
    expect(notes("2026-10-11T06:00:00Z")).toEqual([]);
    expect(notes("2026-10-12T06:00:00Z")).toEqual([]);
    expect(notes(null)).toEqual([]);
    expect(html(ahead({ balance: balance({ balanceAt: "2026-10-09T06:00:00Z" }) }))).toContain('<dd class="st-sub">Saldo päivältä 9.10.2026</dd>');
  });

  it("without a checking balance there are no figures: a sentence, the link to the accounts, and the tables stay", () => {
    const none = ahead({ balance: null, missing: "balance" });
    expect(figures(none)).toBeNull();
    const out = html(none);
    expect(out).toContain(`Tilin saldo ei ole tiedossa. <a href="#/settings#${SETTINGS_ANCHOR.accounts}">Lisää saldo</a>`);
    expect(out).not.toContain("Käytettävissä");
    expect(out).not.toContain("<dl");
    expect(names(out)).toEqual(["Sähköyhtiö Esimerkki", "Esimerkkivakuutus", "Vuokra Esimerkki", "Esimerkki Oy"]);
    // near miss: with a balance the sentence is not there
    expect(html(ahead())).not.toContain("Tilin saldo ei ole tiedossa.");
  });
});

describe("the warning", () => {
  const short = ahead({ balance: balance({ freeCents: -21_240, shortCents: 21_240, shortOn: "2026-10-16" }) });

  it("names the day of the first payment the balance does not reach, and what is missing", () => {
    expect(plain(warning(short)!)).toBe("Tilin kate ei riitä 16.10. erääntyvään maksuun. Puuttuu 212,40 €.");
  });

  it("is not there when nothing is missing, without a balance, or for an account below zero with nothing due", () => {
    expect(warning(ahead())).toBeNull();
    expect(warning(ahead({ balance: balance({ freeCents: 0 }) }))).toBeNull();
    expect(warning(ahead({ balance: null, missing: "balance" }))).toBeNull();
    expect(warning(ahead({ balance: balance({ startCents: -5000, freeCents: -5000, shortCents: 5000, shortOn: null }) }, []))).toBeNull();
    // a cent missing is missing
    expect(plain(warning(ahead({ balance: balance({ freeCents: -1, shortCents: 1, shortOn: "2026-10-21" }) }))!)).toBe("Tilin kate ei riitä 21.10. erääntyvään maksuun. Puuttuu 0,01 €.");
  });

  it("is no warning when every payment of that day is an estimate", () => {
    const of = (rows: Row[]) => ahead({ balance: balance({ freeCents: -500, shortCents: 500, shortOn: "2026-10-20" }) }, rows);
    const card = (basis: Row["basis"]) => row({ date: "2026-10-20", name: "Luottokortti", category: "transfer", cents: -30_000, source: "card", basis });
    expect(plain(warning(of(BILLS))!)).toBe("Arvion mukaan 20.10. maksuista jää kattamatta noin 5,00 €.");
    expect(shortIsEstimate(of(BILLS))).toBe(true);
    expect(shortIsEstimate(of([card("usual")]))).toBe(true);
    // what the card owes today is the bank's figure, and a typed-in bill the household's
    expect(plain(warning(of([card("balance")]))!)).toBe("Tilin kate ei riitä 20.10. erääntyvään maksuun. Puuttuu 5,00 €.");
    expect(shortIsEstimate(of([card("usual"), row({ date: "2026-10-20", source: "expected" })]))).toBe(false);
    expect(shortIsEstimate(short)).toBe(false);
  });

  it("is drawn above the figures, and only when something is missing", () => {
    const out = html(short);
    expect(out).toContain('<p class="notice warning ahead-warning">Tilin kate ei riitä 16.10. erääntyvään maksuun. Puuttuu 212,40 €.</p>');
    expect(out.indexOf("ahead-warning")).toBeLessThan(out.indexOf("<dl"));
    expect(html(ahead())).not.toContain("warning");
  });
});

describe("the two tables", () => {
  it("the payments come in core's order, each with its day and its sum, under Eräpäivä, Saaja and Summa", () => {
    expect(payments(ahead()).map((l) => [l.day, l.name, l.cents])).toEqual([
      ["15.10.", "Sähköyhtiö Esimerkki", 4_500],
      ["20.10.", "Esimerkkivakuutus", 14_230],
      ["21.10.", "Vuokra Esimerkki", 105_000],
    ]);
    const out = html(ahead());
    expect(out).toContain('<caption class="sr-only">Erääntyvät maksut ennen palkkapäivää</caption>');
    expect(out).toContain('<th scope="col">Eräpäivä</th><th scope="col">Saaja</th><th scope="col" class="num">Summa</th>');
    expect(out).toContain('<tr><td data-label="Eräpäivä"><span class="src src-est" aria-hidden="true"></span>15.10.</td><td title="Sähköyhtiö Esimerkki" data-label="Saaja"><a href="#/transactions?merchant=S%C3%A4hk%C3%B6yhti%C3%B6+Esimerkki">Sähköyhtiö Esimerkki</a></td><td class="num" data-label="Summa">45,00 €</td></tr>');
  });

  it("the payments on the page add up to the figure of what is due", () => {
    const out = html(ahead());
    const table = out.slice(out.indexOf("<table"), out.indexOf("</table>"));
    const listed = [...table.matchAll(/<td class="num" data-label="Summa">([\d ]+,\d\d) €<\/td>/g)].map((m) => Math.round(Number(m[1]!.replace(/ /g, "").replace(",", ".")) * 100));
    expect(listed).toHaveLength(3);
    expect(listed.reduce((s, c) => s + c, 0)).toBe(ahead().totals.dueCents);
  });

  it("Saapuvat maksut holds other pay of the window and the pay it waits for as its last row", () => {
    const a = ahead({}, [...BILLS, OTHER_PAY].sort((x, y) => x.date.localeCompare(y.date)));
    expect(incoming(a).map((l) => [l.day, l.name, l.cents])).toEqual([
      ["14.10.", "Pieni Esimerkki Oy", 80_000],
      ["23.10.", "Esimerkki Oy", 300_000],
    ]);
    // the pay is a row of its own table and of no payment
    expect(payments(a).map((l) => l.name)).toEqual(["Sähköyhtiö Esimerkki", "Esimerkkivakuutus", "Vuokra Esimerkki"]);
    const out = html(a);
    expect(names(out)).toEqual(["Sähköyhtiö Esimerkki", "Esimerkkivakuutus", "Vuokra Esimerkki", "Pieni Esimerkki Oy", "Esimerkki Oy"]);
    expect(out).toContain('<caption class="st-cap">Saapuvat maksut</caption>');
    expect(out).toContain('<th scope="col">Päivä</th><th scope="col">Maksaja</th><th scope="col" class="num">Summa</th>');
    expect(out).toContain('<td class="num" data-label="Summa">noin 3 000 €</td>');
    expect(out.indexOf("Saapuvat maksut")).toBeGreaterThan(out.indexOf("</table>"));
  });

  it("Saapuvat maksut is not drawn without a pay to arrive", () => {
    expect(html(ahead(NONE))).not.toContain("Saapuvat maksut");
    expect(html(ahead(LATE))).not.toContain("Saapuvat maksut");
    // other pay alone is enough
    expect(html(ahead(NONE, [OTHER_PAY]))).toContain("Saapuvat maksut");
  });

  it("calls every row by the name core gives it: the card's plain name, and a bracket in a merchant's name stays", () => {
    const card = row({ date: "2026-10-16", name: "Esimerkkipankki Gold", category: "transfer", cents: -64_230, source: "card", basis: "balance" });
    const lines = payments(ahead({}, [BILLS[0]!, card]));
    expect(lines.map((l) => l.name)).toEqual(["Sähköyhtiö Esimerkki", "Esimerkkipankki Gold"]);
    expect(payments(ahead({}, [row({ name: "Kahvila Esimerkki (credit)" })]))[0]!.name).toBe("Kahvila Esimerkki (credit)");
    expect(names(html(ahead({}, [card])))).toEqual(["Esimerkkipankki Gold", "Esimerkki Oy"]);
  });

  it("a bill that is paid and not booked yet carries Tapahtumat's word for such a row after the payee, and no other row does", () => {
    const rows = [{ ...BILLS[0]!, pending: true as const }, BILLS[1]!];
    expect(payments(ahead({}, rows)).map((l) => [l.name, l.pending ?? false])).toEqual([["Sähköyhtiö Esimerkki", true], ["Esimerkkivakuutus", false]]);
    const out = html(ahead({}, rows));
    expect(out.match(/<span class="badge warn">varaus<\/span>/g)).toHaveLength(1);
    expect(out).toContain('<div class="payee-pending"><span><a href="#/transactions?merchant=S%C3%A4hk%C3%B6yhti%C3%B6+Esimerkki">Sähköyhtiö Esimerkki</a></span><span class="badge warn">varaus</span></div></td>');
    expect(html(ahead())).not.toContain("varaus");
  });

  it("names the table of the payments for a reader that has no eyes for it", () => {
    expect(paymentsCaption(ahead())).toBe("Erääntyvät maksut ennen palkkapäivää");
    expect(paymentsCaption(ahead(NONE))).toBe("Erääntyvät maksut seuraavan 30 päivän aikana");
  });
});

describe("what stands in place of the payments, and under the tables", () => {
  it("says nothing is due as a sentence, with no table, when the window has no payment", () => {
    const empty = '<p class="st-note">Ei erääntyviä maksuja.</p>';
    for (const a of [ahead({}, []), ahead(NONE, [OTHER_PAY]), ahead(LATE, []), ahead(NONE, [])]) expect(html(a)).toContain(empty);
    const out = html(ahead({}, []));
    // the pay still has its table, and the figures are there
    expect(out).not.toContain("Eräpäivä");
    expect(names(out)).toEqual(["Esimerkki Oy"]);
    expect(out).toContain("Käytettävissä");
    // near miss: one payment, and the row is not there
    expect(html(ahead({}, [BILLS[0]!]))).not.toContain("Ei erääntyviä maksuja.");
  });

  it("tells no usual spending of a day: a modelled figure is no line of the statement", () => {
    expect(html(ahead())).not.toContain("tavallisesti");
    expect(html(ahead())).not.toContain("päivässä");
  });

  it("says the days and the sums are estimates over the line of days, only when a payment is listed", () => {
    const note = '<p class="st-note ahead-estimates">Eräpäivät ja summat ovat arvioita.</p>';
    const out = html(ahead());
    expect(out).toContain(note);
    // a reader meets it before the line and before the tables
    expect(out.indexOf(note)).toBeLessThan(out.indexOf('class="nd-line'));
    expect(out.indexOf(note)).toBeLessThan(out.indexOf("<table"));
    expect(html(ahead({}, []))).not.toContain("arvioita");
  });

  it("links Laskut and Lisää lasku at the foot, whatever the window holds", () => {
    for (const a of [ahead(), ahead(NONE, []), ahead({ balance: null, missing: "balance" })]) {
      expect(html(a)).toContain('<p class="st-links"><a href="#/bills">Laskut</a><a href="#/bills">Lisää lasku</a></p>');
    }
  });

  it("draws the line of days only when a payment is due, and has no canvas, no switch and no table of days", () => {
    const out = html(ahead({}, [...BILLS, OTHER_PAY]));
    expect(out).toContain('class="nd-line');
    for (const gone of ["<canvas", "<button", "Kaavio", "Taulukko", "Alin saldo", "Lähtösaldo"]) expect(out, gone).not.toContain(gone);
    // no payment: the block is its figures and its tables, with no empty axis
    for (const a of [ahead({}, []), ahead({}, [OTHER_PAY]), ahead(NONE, [])]) for (const gone of ["nd-line", "<svg", "nd-axis"]) expect(html(a), gone).not.toContain(gone);
  });
});

describe("the coming pay is an estimate", () => {
  const pay = (p: Ahead["payday"]) => ahead({ payday: p });
  const sumsOf = (a: Ahead) => incoming(a).map((l) => l.sum && plain(l.sum));

  it("says a steady pay as noin its usual sum, marked an estimate", () => {
    const a = pay({ date: "2026-10-23", name: "Esimerkki Oy", pay: steady(248_000) });
    expect(sumsOf(a)).toEqual(["noin 2 480 €"]);
    expect(incoming(a)[0]).toMatchObject({ estimate: true });
    const out = html(a);
    expect(out).toContain('<span class="src src-est" aria-hidden="true"></span>23.10.');
    expect(out).not.toContain("Palkka vaihtelee");
  });

  it("says a pay that varies as the range of the estimate, with one sentence of the pays that came", () => {
    const a = pay({ date: "2026-10-23", name: "Esimerkki Oy", pay: varies({ baseCents: 195_000 }) });
    expect(sumsOf(a)).toEqual(["2 100–2 900 €"]);
    expect(plain(payNote(a)!)).toBe("Palkka vaihtelee: viimeiset 12 palkkaa 1 950–3 240 €, useimmiten 2 480 €. Joka kerta on tullut vähintään 1 950 €.");
    const out = html(a);
    expect(out).toContain('<td class="num" data-label="Summa">2 100–2 900 €</td>');
    expect(out.indexOf("Palkka vaihtelee")).toBeGreaterThan(out.indexOf("Saapuvat maksut"));
    // the sum of no figure of the block moves with the estimate
    expect(figures(a)!.map((f) => f.cents)).toEqual(figures(ahead())!.map((f) => f.cents));
  });

  it("leaves the base sentence out without a base", () => {
    const a = pay({ date: "2026-10-23", name: "Esimerkki Oy", pay: varies() });
    expect(plain(payNote(a)!)).toBe("Palkka vaihtelee: viimeiset 12 palkkaa 1 950–3 240 €, useimmiten 2 480 €.");
  });

  it("shows a pay with no estimate as its day and a dash, and says nothing of a sum", () => {
    const a = pay({ date: "2026-10-23", name: "Esimerkki Oy", pay: null });
    expect(incoming(a)[0]).toMatchObject({ day: "23.10.", cents: null, sum: null });
    expect(payNote(a)).toBeNull();
    const out = html(a);
    expect(out).toContain('<td class="num" data-label="Summa">–</td>');
    expect(out).not.toContain("noin");
    expect(out).not.toContain("vaihtelee");
  });

  it("gives other pay that varies its range too, and only the pay of the window a sentence", () => {
    const other = row({ date: "2026-10-14", name: "Pieni Esimerkki Oy", category: "salary", cents: 210_000, source: "income", pay: varies() });
    const a = ahead({}, [...BILLS, other]);
    expect(sumsOf(a)).toEqual(["2 100–2 900 €", "noin 3 000 €"]);
    expect(payNote(a)).toBeNull();
  });
});
