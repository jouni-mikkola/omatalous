import { countingMark, marksBySubject, seriesMarkSubject, type UserMark } from "@banking/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Coming } from "../src/components/bills/Coming.tsx";
import { Subscriptions } from "../src/components/bills/Subscriptions.tsx";
import { NextDays } from "../src/components/NextDays.tsx";
import type { DashboardData, Recurring } from "../src/types.ts";
import { steady } from "./pay-fixture.ts";

type Ahead = NonNullable<DashboardData["ahead"]>;
type Row = Ahead["rows"][number];

const sum = (rows: Row[], source: Row["source"]) => rows.filter((r) => r.source === source).reduce((total, r) => total + Math.abs(r.cents), 0);
const row = (over: Partial<Row>): Row => ({ date: "2026-10-15", name: "Palkka", category: "salary", cents: 395_000, source: "income", pay: steady(395_000), ...over });
/** A 30-day answer as the dashboard gives it: a pay day, two bills of the history and one the household typed in. */
const ahead = (rows: Row[] = [row({}), row({ date: "2026-10-12", name: "Sähkö", category: "utilities", cents: -8_900, source: "recurring" }), row({ date: "2026-10-20", name: "Netflix", category: "subscriptions", cents: -1_599, source: "recurring" }), row({ date: "2026-11-03", name: "Ajoneuvovero", category: null, cents: -31_250, source: "expected" })]): Ahead => ({
  from: "2026-10-11",
  to: "2026-11-10",
  days: 30,
  reason: "none",
  payday: null,
  rows,
  upcoming: rows.filter((r) => r.cents < 0),
  everydayPerDayCents: 0,
  totals: { recurringCents: sum(rows, "recurring"), typedCents: sum(rows, "expected"), cardCents: 0, transferCents: 0, dueCents: sum(rows, "recurring") + sum(rows, "expected"), incomeCents: sum(rows, "income") },
  balance: null,
  missing: "balance",
});

const label = (id: string) => ({ utilities: "Sähkö ja vesi", subscriptions: "Tilaukset" })[id] ?? id;
/** The markup with the spaces of the money format made plain, so a test reads "417 €". */
const flat = (html: string) => html.replace(/[\u00a0\u202f]/g, " ");
const coming = (a: Ahead | null) => flat(renderToStaticMarkup(createElement(Coming, { ahead: a, today: "2026-10-11", onAdded: () => {} })));
const nextDays = (a: Ahead) => flat(renderToStaticMarkup(createElement(NextDays, { ahead: a })));

/** The same answer with a pay to wait for on Thu 15.10.: the window ends the day before it. */
const beforePay = (a: Ahead, date = "2026-10-15"): Ahead => ({ ...a, reason: "payday", payday: { date, name: "Palkka", pay: steady(395_000) }, to: "2026-10-14", days: 3 });
/** The head rows of the groups, each as its name and its sum. */
const groupHeads = (html: string) => [...html.matchAll(/<tr class="group-head"><th[^>]*>([^<]*)<\/th><td class="st-num">(.*?)<\/td><\/tr>/g)].map((m) => `${m[1]}: ${m[2]!.replace(/<[^>]*>/g, "")}`);

describe("Laskut: Erääntyvät maksut", () => {
  it("with no pay known lists the bills of the next 30 days in one group, the typed-in one marked, and no pay day", () => {
    const out = coming(ahead());
    expect(out).toContain("<h2>Erääntyvät maksut</h2>");
    // 89 + 15,99 + 312,50
    expect(groupHeads(out)).toEqual(["Seuraavat 30 päivää: 417,49 €"]);
    for (const name of ["Sähkö", "Netflix", "Ajoneuvovero"]) expect(out).toContain(name);
    expect(out).toContain("lisätty käsin");
    expect(out).not.toContain("Palkka");
    // the payments are not counted under the heading
    expect(out).not.toContain("maksua");
    // the dates in the order the rows come, and the amounts as bills (no minus)
    expect(out.indexOf("Sähkö")).toBeLessThan(out.indexOf("Netflix"));
    expect(out).toContain("12.10.");
  });

  it("is a table of Eräpäivä, Saaja and Summa in that order, each row the day, the payee and the sum, and no line under the payee", () => {
    const out = coming(ahead());
    const heads = [...out.matchAll(/<th scope="col"[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    expect(heads).toEqual(["Eräpäivä", "Saaja", "Summa"]);
    expect(out).toMatch(/<td class="due-col"><span class="src[^"]*" aria-hidden="true"><\/span>12\.10\.<\/td><td><a href="[^"]*">Sähkö<\/a><\/td><td class="st-num sum">89,00 €<\/td>/);
    // the category of a row is not said: the label of "utilities" is not in the markup
    expect(out).not.toContain("Sähkö ja vesi");
    expect(out).not.toContain('class="sub"');
    // near miss: the typed-in bill keeps its mark in the payee cell
    expect(out).toMatch(/<td>Ajoneuvovero <span class="badge">lisätty käsin<\/span><\/td>/);
  });

  it("its sum is the Erääntyvät maksut of Yhteenveto: one list, one total", () => {
    const rows = ahead();
    expect(groupHeads(coming(rows))).toEqual(["Seuraavat 30 päivää: 417,49 €"]);
    const balance = { startCents: 100_000, counts: "all" as const, accounts: 1, balanceAt: null, freeCents: 58_251, shortCents: 0, shortOn: null };
    expect(nextDays({ ...rows, balance, missing: null })).toContain('<dt class="st-name">Erääntyvät maksut</dt><dd class="st-num">417,49 €</dd>');
  });

  it("with a pay to wait for it has the window of Yhteenveto and what comes after it, and the two sums are the sum of the one list", () => {
    const out = coming(beforePay(ahead()));
    // 89 before the pay; 15,99 + 312,50 after it: 417,49 in all, the sum of the list without a pay
    expect(groupHeads(out)).toEqual(["Palkkapäivään asti, to 15.10.: 89,00 €", "Palkkapäivän jälkeen: 328,49 €"]);
    const at = (text: string) => out.indexOf(text);
    expect(at("Palkkapäivään asti")).toBeLessThan(at("Sähkö"));
    expect(at("Sähkö")).toBeLessThan(at("Palkkapäivän jälkeen"));
    expect(at("Palkkapäivän jälkeen")).toBeLessThan(at("Netflix"));
    expect(out).not.toContain("Seuraavat 30 päivää");
    // the line of Yhteenveto, word for word
    expect(nextDays(beforePay(ahead()))).toContain("Palkkapäivään asti, to 15.10.");
  });

  it("a bill due on the day of the pay is after it, and a group to the pay with nothing due says so with its sum", () => {
    const onPayDay = [row({ date: "2026-10-15", name: "Vuokra", category: null, cents: -90_000, source: "recurring" })];
    expect(groupHeads(coming(beforePay(ahead(onPayDay))))).toEqual(["Palkkapäivään asti, to 15.10.: 0,00 €", "Palkkapäivän jälkeen: 900,00 €"]);
    // the last day of the window is before the pay
    const dayBefore = [row({ date: "2026-10-14", name: "Vuokra", category: null, cents: -90_000, source: "recurring" })];
    expect(groupHeads(coming(beforePay(ahead(dayBefore))))).toEqual(["Palkkapäivään asti, to 15.10.: 900,00 €"]);
  });

  it("what a credit card is charged is a third group with its own sum, and the first group's sum is the figure of Yhteenveto", () => {
    const music = row({ date: "2026-10-13", name: "Musiikkipalvelu", category: "subscriptions", cents: -1_199, source: "recurring", onCard: true });
    const film = row({ date: "2026-10-28", name: "Elokuvapalvelu", category: "subscriptions", cents: -1_390, source: "recurring", onCard: true });
    const base = beforePay(ahead());
    const withCard = { ...base, upcoming: [...base.upcoming, music, film] };
    const out = coming(withCard);
    // the card's 11,99 of 13.10. is before the pay by its day, and is in neither sum of what the accounts pay
    expect(groupHeads(out)).toEqual(["Palkkapäivään asti, to 15.10.: 89,00 €", "Palkkapäivän jälkeen: 328,49 €", "Kortilta veloitettavat: 25,89 €"]);
    expect(out.indexOf("Kortilta veloitettavat")).toBeGreaterThan(out.indexOf("Ajoneuvovero"));
    expect(out.indexOf("Musiikkipalvelu")).toBeGreaterThan(out.indexOf("Kortilta veloitettavat"));
    // Yhteenveto's figure of the same window is the first group's sum: no card's bill and no transfer is in it
    const balance = { startCents: 100_000, counts: "all" as const, accounts: 1, balanceAt: null, freeCents: 91_100, shortCents: 0, shortOn: null };
    const window = base.rows.filter((r) => r.cents < 0 && r.date <= base.to);
    expect(nextDays({ ...withCard, rows: window, totals: { ...base.totals, recurringCents: 8_900, typedCents: 0, dueCents: 8_900 }, balance, missing: null })).toContain('<dt class="st-name">Erääntyvät maksut</dt><dd class="st-num">89,00 €</dd>');
    // near misses: without a card's row there is no third group, and with no pay to wait for the card's rows are still apart
    expect(groupHeads(coming(base))).toHaveLength(2);
    expect(groupHeads(coming({ ...ahead(), upcoming: [...ahead().upcoming, music] }))).toEqual(["Seuraavat 30 päivää: 417,49 €", "Kortilta veloitettavat: 11,99 €"]);
  });

  it("on the payday, before the pay is booked, a bill paid from the pay is after it and a debit of the day is before it", () => {
    const today = { ...beforePay(ahead([]), "2026-10-11"), to: "2026-10-11", days: 0 };
    const rent = row({ date: "2026-10-11", name: "Vuokra", category: null, cents: -90_000, source: "recurring", withPay: true });
    const debit = row({ date: "2026-10-11", name: "Puhelin", category: null, cents: -2_990, source: "recurring" });
    expect(groupHeads(coming({ ...today, upcoming: [rent, debit] }))).toEqual(["Palkkapäivään asti, su 11.10.: 29,90 €", "Palkkapäivän jälkeen: 900,00 €"]);
  });

  it("a bill that is paid and not booked yet carries varaus after its payee, and the group's sum holds it", () => {
    const paid = row({ date: "2026-10-13", name: "Vakuutus", category: null, cents: -14_230, source: "recurring", pending: true });
    const other = row({ date: "2026-10-14", name: "Puhelin", category: null, cents: -2_990, source: "recurring" });
    const out = coming({ ...beforePay(ahead([])), upcoming: [paid, other] });
    expect(out.match(/<span class="badge warn">varaus<\/span>/g)).toHaveLength(1);
    expect(out).toMatch(/Vakuutus<\/a><\/span><span class="badge warn">varaus<\/span>/);
    expect(groupHeads(out)).toEqual(["Palkkapäivään asti, to 15.10.: 172,20 €"]);
    expect(coming({ ...beforePay(ahead([])), upcoming: [other] })).not.toContain("varaus");
  });

  it("a pay behind its day with no pay to come is one group of the 30 days, and with one to come the group names that day", () => {
    const behind = { date: "2026-10-11", expected: "2026-10-09", name: "Palkka", pay: steady(395_000) };
    expect(groupHeads(coming({ ...ahead(), reason: "payday", payday: behind }))).toEqual(["Seuraavat 30 päivää: 417,49 €"]);
    const next = { ...ahead(), reason: "payday" as const, payday: { ...behind, next: "2026-10-15" }, to: "2026-10-14", days: 3 };
    expect(groupHeads(coming(next))).toEqual(["Palkkapäivään asti, to 15.10. Palkka ei ole vielä tullut, sen piti tulla pe 9.10.: 89,00 €", "Palkkapäivän jälkeen: 328,49 €"]);
  });

  it("lists every row of the 30 days, however many, with no fold and no count, and each group has the sum of its rows", () => {
    const many = Array.from({ length: 12 }, (_, i) => row({ date: `2026-10-${String(13 + i).padStart(2, "0")}`, name: `Lasku ${i + 1}`, category: null, cents: -1_000, source: "recurring" }));
    const out = coming(beforePay(ahead(many)));
    // 13.10. and 14.10. before the pay, ten after it: 12 in all
    expect(groupHeads(out)).toEqual(["Palkkapäivään asti, to 15.10.: 20,00 €", "Palkkapäivän jälkeen: 100,00 €"]);
    for (let i = 1; i <= 12; i++) expect(out).toContain(`Lasku ${i}<`);
    expect(out).not.toContain("Näytä kaikki");
    expect(out).not.toContain("Näytä vähemmän");
    expect(out).not.toContain("(12)");
  });

  it("offers the form behind Lisää lasku and not before", () => {
    const out = coming(ahead());
    expect(out).toContain("Lisää lasku");
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain('aria-label="Lisää lasku"');
  });

  it("without bills or a dashboard answer it still opens the form", () => {
    expect(coming(ahead([row({})]))).toContain("Ei laskuja seuraavan 30 päivän aikana.");
    expect(coming(null)).toContain("Lisää lasku");
  });
});

describe("Laskut: the marks of Erääntyvät maksut", () => {
  it("brackets the rows of a group of two or more, which add up to its sum, and the group of one has none", () => {
    const out = coming(ahead());
    expect(out).toContain('<tbody class="adds-up">');
    expect(out).toContain('<tr class="part-first">');
    expect(out).toContain('<tr class="part-last">');
    const one = coming(ahead([row({ date: "2026-10-12", name: "Sähkö", category: "utilities", cents: -8_900, source: "recurring" })]));
    expect(one).not.toContain("adds-up");
    expect(one).not.toContain("part-first");
  });

  it("puts a disc before the day of a typed bill and a ring before an estimated one", () => {
    const out = coming(ahead());
    expect(out).toMatch(/<span class="src" aria-hidden="true"><\/span>\d+\.\d+\.<\/td><td>Ajoneuvovero/);
    expect(out).toMatch(/<span class="src src-est" aria-hidden="true"><\/span>12\.10\.<\/td><td><a[^>]*>Sähkö/);
  });
});

describe("Yhteenveto: Erääntyvät maksut", () => {
  it("lists the bills before the pay and links to Laskut", () => {
    const out = nextDays(ahead());
    expect(out).toContain(">Erääntyvät maksut</h2>");
    expect(out).toContain("Erääntyvät maksut seuraavan 30 päivän aikana</caption>");
    for (const name of ["Sähkö", "Netflix", "Ajoneuvovero"]) expect(out).toContain(name);
    expect(out.indexOf("Ajoneuvovero")).toBeLessThan(out.indexOf(">Palkka</a>"));
    expect(out).toContain('href="#/bills"');
    expect(out).not.toContain("Näytä kaikki");
  });

  it("says nothing is due while there is no bill to show, and still links to Laskut, where one is added", () => {
    const out = nextDays(ahead([row({})]));
    expect(out).toContain(">Ei erääntyviä maksuja.</td>");
    expect(out).toContain('<a href="#/bills">Lisää lasku</a>');
  });
});

describe("Laskut: Tilaukset and a mark on one subscription", () => {
  const TODAY = "2026-10-11";
  const sub = (over: Partial<Recurring>): Recurring => ({
    id: "out:acc-1:Spotify",
    merchant: "Spotify",
    category: "subscriptions",
    kind: "subscription",
    cadence: "monthly",
    intervalDays: 30,
    occurrences: 12,
    firstDate: "2025-11-03",
    lastDate: "2026-10-03",
    nextDate: "2026-11-03",
    typicalAmountCents: 1099,
    lastAmountCents: 1099,
    monthlyCents: 1099,
    yearlyCents: 13188,
    perMonth: 1,
    monthsActive: 12,
    active: true,
    overdue: false,
    review: true,
    confidence: 1,
    priceChange: null,
    ...over,
  });
  const storage = sub({ id: "out:acc-1:Apple#799", merchant: "Apple", typicalAmountCents: 799, monthlyCents: 799, yearlyCents: 9588 });
  const music = sub({ id: "out:acc-1:Apple#1299", merchant: "Apple", typicalAmountCents: 1299, monthlyCents: 1299, yearlyCents: 15588 });
  const spotify = sub({});
  const mark = (subject: string, kind: UserMark["mark"]): UserMark => ({ subject, mark: kind, markedAt: "2026-10-01T09:00:00+03:00" });
  /** The card as the page builds it: the marks decide which rows are asked about and which are listed as cancelled. */
  const card = (rows: Recurring[], marks: UserMark[]) => {
    const byCover = marksBySubject(marks);
    const markOf = (s: Recurring) => countingMark(byCover, s, TODAY);
    const stopped = rows.filter((s) => markOf(s)?.mark === "cancelled");
    const subs = rows.filter((s) => !stopped.includes(s));
    const controls = { markOf, busy: false, set: () => {}, clear: () => {} };
    return flat(renderToStaticMarkup(createElement(Subscriptions, { subs, stopped, total: subs.reduce((sum, s) => sum + s.monthlyCents, 0), controls, label })));
  };
  /** The part of the markup that is one row, found by a text only that row has. */
  const rowWith = (out: string, text: string) => out.split("<tr").find((r) => r.includes(text)) ?? "";

  it("a merchant with one subscription looks as before: its name on the row and in the buttons, no price after it", () => {
    const out = card([spotify], []);
    expect(out).toContain('aria-label="Käytössä: Spotify"');
    expect(out).toContain('aria-label="Lopetettu: Spotify"');
    expect(out).not.toContain('class="muted"');
    expect(card([spotify], [mark(seriesMarkSubject(spotify), "in_use")])).toContain('aria-label="Kumoa: Spotify"');
  });

  it("with several from one merchant each row and its buttons say the price, and a mark shows on its own row only", () => {
    const out = card([storage, music, spotify], []);
    for (const name of ["Käytössä: Apple 7,99 €", "Lopetettu: Apple 7,99 €", "Käytössä: Apple 12,99 €", "Lopetettu: Apple 12,99 €", "Käytössä: Spotify"]) expect(out).toContain(`aria-label="${name}"`);
    expect(out).toContain('<span class="muted"> 7,99 €</span>');
    expect(out).toContain('<span class="muted"> 12,99 €</span>');

    const marked = card([storage, music, spotify], [mark(seriesMarkSubject(storage), "cancelled")]);
    expect(marked).toContain("Merkitty lopetetuksi");
    expect(rowWith(marked, "Kumoa: Apple 7,99 €")).toContain("Lopetettu</span>");
    expect(marked).toContain('aria-label="Lopetettu: Apple 12,99 €"');
    expect(marked).not.toContain("Kumoa: Apple 12,99 €");
    expect(marked).not.toContain("Koskee kaikkia");
    // the header counts what is left: 12,99 + 10,99
    expect(marked).toContain('<div class="card-datum"><span class="fig fig-s"><span class="fig-int">24</span><span class="fig-unit"> €/kk</span></span></div>');
  });

  it("an old mark on the merchant shows on every row of it, says so, and is undone for the merchant", () => {
    const out = card([storage, music, spotify], [mark("merchant:Apple", "cancelled")]);
    for (const price of ["7,99 €", "12,99 €"]) {
      const row = rowWith(out, `<span class="muted"> ${price}</span>`);
      expect(row).toContain("Lopetettu</span>");
      expect(row).toContain("Koskee kaikkia kauppiaan tilauksia.");
      expect(row).toContain('aria-label="Kumoa: Apple"');
    }
    expect(out).toContain('aria-label="Käytössä: Spotify"');
    // on a merchant with one subscription there is nothing to add
    expect(card([spotify], [mark("merchant:Spotify", "in_use")])).not.toContain("Koskee kaikkia");
  });

  it("is one list under one head row, with no sentence on a card, a group or a row", () => {
    const out = card([storage, music, spotify], []);
    // the three rows asked about are the list; no group head, no count, no saving, no explanation
    expect(out).not.toContain("group-head");
    for (const gone of ["Tarkista nämä", "Muut tilaukset", "Pieniä palveluja", "Lopettamalla säästät", "tilausta", "Ei mukana summassa", "card-sub"]) expect(out).not.toContain(gone);
    const heads = [...out.matchAll(/<th>([^<]*)<\/th>|<th class="[^"]*">([^<]*)<\/th>/g)].map((m) => m[1] ?? m[2]);
    expect(heads).toEqual(["Saaja", "Tiheys", "Summa", "Kuussa", "Vuodessa", "Seuraava"]);
    // a row says its category and nothing else under the payee
    expect(rowWith(out, ">Spotify</a>")).toContain('<div class="sub">Tilaukset</div>');
    expect(out).not.toContain("kertaa");
  });

  it("puts the rows that are asked about first, and the others after them", () => {
    const answered = sub({ id: "out:acc-1:Yle", merchant: "Yle", review: true });
    const small = sub({ id: "out:acc-1:Lehti", merchant: "Lehti", review: false });
    const out = card([small, answered, spotify], [mark(seriesMarkSubject(answered), "in_use")]);
    // Spotify is asked about; Lehti is not asked about; Yle has a mark
    expect(out.indexOf(">Spotify</a>")).toBeLessThan(out.indexOf(">Lehti</a>"));
    expect(out.indexOf(">Spotify</a>")).toBeLessThan(out.indexOf(">Yle</a>"));
    expect(out).not.toContain("group-head");
  });

  it("ends the list in a row Yhteensä with the sums of the columns Kuussa and Vuodessa", () => {
    const foot = rowWith(card([storage, music, spotify], []), "Yhteensä");
    // 7,99 + 12,99 + 10,99 a month = 31,97; 95,88 + 155,88 + 131,88 a year = 383,64
    expect(foot).toContain('<th scope="row">Yhteensä</th>');
    expect(foot).toContain('<td class="num">32 €</td>');
    expect(foot).toContain('<td class="num hide-phone">384 €</td>');
  });

  it("brackets Kuussa to Yhteensä and tracks each row's share only when they add up, and not when the rounded rows miss by a euro", () => {
    const out = card([storage, music, spotify], []);
    // 8 + 13 + 11 = 32; 7,99 + 12,99 + 10,99 is 25 %, 41 % and 34 % of 31,97
    expect(out).toContain('<tbody class="adds-up">');
    expect(out).toContain('<tr class="part-first">');
    expect(out).toContain('<tr class="part-last">');
    expect(out.match(/<td class="num share sum" style="--from:\d+;--part:\d+">/g)).toHaveLength(3);
    // 1,49 + 1,49 = 2,98: 1 + 1 under 3 prints a bracket that is false, the tracks still add up to 100
    const a = sub({ id: "out:acc-1:A", merchant: "A", monthlyCents: 149 });
    const b = sub({ id: "out:acc-1:B", merchant: "B", monthlyCents: 149 });
    const near = card([a, b], []);
    expect(near).not.toContain("adds-up");
    expect(near).toContain("num share sum");
  });

  it("leaves a stopped subscription out of the row Yhteensä, and lists it below that row under its head", () => {
    const out = card([storage, music, spotify], [mark(seriesMarkSubject(storage), "cancelled")]);
    // 12,99 + 10,99 = 23,98 a month; 155,88 + 131,88 = 287,76 a year
    const foot = rowWith(out, "Yhteensä");
    expect(foot).toContain('<td class="num">24 €</td>');
    expect(foot).toContain('<td class="num hide-phone">288 €</td>');
    // the figure of the foot is the figure of the card header
    expect(out).toContain('<div class="card-datum"><span class="fig fig-s"><span class="fig-int">24</span><span class="fig-unit"> €/kk</span></span></div>');
    expect(out.indexOf("Yhteensä")).toBeLessThan(out.indexOf("Merkitty lopetetuksi"));
    expect(out.indexOf("Merkitty lopetetuksi")).toBeLessThan(out.indexOf("Kumoa: Apple 7,99 €"));
    // near miss: a card with nothing stopped has no such group
    expect(card([spotify], [])).not.toContain("Merkitty lopetetuksi");
  });

  it("has no foot row, and no list, when every subscription is stopped", () => {
    const out = card([spotify], [mark(seriesMarkSubject(spotify), "cancelled")]);
    expect(out).not.toContain("Yhteensä");
    expect(out).toContain("Merkitty lopetetuksi");
  });
});
