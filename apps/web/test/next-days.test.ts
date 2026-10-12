import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NextDays } from "../src/components/NextDays.tsx";
import { type Ahead, figures, footnote, heading, listCaption, payLine, warning } from "../src/components/next-days.ts";

type Row = Ahead["rows"][number];
type Balance = NonNullable<Ahead["balance"]>;

/** The text as a reader sees it: the spaces inside a sum are plain ones. */
const plain = (s: string) => s.replace(/[  ]/g, " ").replace(/−/g, "-");

const row = (over: Partial<Row>): Row => ({ date: "2026-10-15", name: "Sähköyhtiö Esimerkki", category: "utilities", cents: -4_500, source: "recurring", ...over });
const BILLS = [row({}), row({ date: "2026-10-20", name: "Esimerkkivakuutus", cents: -14_230 }), row({ date: "2026-10-21", name: "Vuokra Esimerkki", cents: -105_000, source: "expected" })];

const balance = (over: Partial<Balance> = {}): Balance => ({
  startCents: 200_000,
  counts: "all",
  accounts: 1,
  balanceAt: "2026-10-12T06:00:00Z",
  days: [
    { date: "2026-10-12", cents: 200_000 },
    { date: "2026-10-22", cents: 70_000 },
  ],
  last: { date: "2026-10-22", cents: 70_000 },
  lowest: { date: "2026-10-22", cents: 70_000 },
  ...over,
});

/** A payday window as core gives it: Monday 12.10., the pay on Friday 23.10., the window to Thursday 22.10. */
function ahead(over: Partial<Ahead> = {}, rows: Row[] = BILLS): Ahead {
  const sum = (source: Row["source"]) => rows.filter((r) => r.source === source).reduce((s, r) => s + Math.abs(r.cents), 0);
  return {
    from: "2026-10-12",
    to: "2026-10-22",
    days: 10,
    reason: "payday",
    payday: { date: "2026-10-23", name: "Esimerkki Oy", cents: 300_000 },
    rows,
    upcoming: rows.filter((r) => r.cents < 0),
    everydayPerDayCents: 3_000,
    totals: { recurringCents: sum("recurring"), typedCents: sum("expected"), everydayCents: 30_000, incomeCents: sum("income"), cardCents: 0, transferCents: 0 },
    balance: balance(),
    missing: null,
    ...over,
  };
}

const html = (a: Ahead) => plain(renderToStaticMarkup(createElement(NextDays, { ahead: a })));
const list = (out: string) => [...out.matchAll(/<tr><td><a [^>]*>([^<]+)<\/a><\/td>/g)].map((m) => m[1]);

describe("the heading, by what the window waits for", () => {
  it("names the payday, its weekday and the days to it", () => {
    expect(heading(ahead())).toEqual({ title: "Palkkapäivä pe 23.10.", sub: "11 päivän päästä" });
  });

  it("says tomorrow and today in words", () => {
    expect(heading(ahead({ to: "2026-10-12", days: 0, payday: { date: "2026-10-13", name: "Esimerkki Oy", cents: 300_000 } }))).toEqual({ title: "Palkkapäivä ti 13.10.", sub: "huomenna" });
    expect(heading(ahead({ to: "2026-10-12", days: 0, payday: { date: "2026-10-12", name: "Esimerkki Oy", cents: 300_000 } }))).toEqual({ title: "Palkkapäivä ma 12.10.", sub: "tänään" });
  });

  it("a pay whose day has gone by and that is not late yet keeps the day it was expected, in the title and on its line", () => {
    const waited = ahead({ to: "2026-10-12", days: 0, payday: { date: "2026-10-12", expected: "2026-10-09", name: "Esimerkki Oy", cents: 300_000 } });
    expect(heading(waited)).toEqual({ title: "Palkkapäivä pe 9.10.", sub: "Palkka ei ole vielä tullut." });
    expect(payLine(waited)).toEqual({ name: "Esimerkki Oy", when: "pe 9.10.", cents: 300_000 });
    // near miss: the same pay due today has one day, and it is today
    const due = ahead({ to: "2026-10-12", days: 0, payday: { date: "2026-10-12", name: "Esimerkki Oy", cents: 300_000 } });
    expect([heading(due).sub, payLine(due)!.when]).toEqual(["tänään", "ma 12.10."]);
  });

  it("without a payday it is the 30 days of today", () => {
    expect(heading(ahead({ reason: "none", payday: null, days: 30, to: "2026-11-11" }))).toEqual({ title: "Seuraavat 30 päivää", sub: "Palkkapäivä ei ole tiedossa." });
  });

  it("with a late pay it says the pay is late and since when", () => {
    const late = ahead({ reason: "late", payday: { date: "2026-10-09", name: "Esimerkki Oy", cents: 300_000 }, days: 30, to: "2026-11-11" });
    expect(heading(late)).toEqual({ title: "Seuraavat 30 päivää", sub: "Palkka on myöhässä, sen piti tulla pe 9.10." });
    // the pay that is late is no line of the list: nothing is coming on a day to wait for
    expect(payLine(late)).toBeNull();
  });
});

describe("the figures a person decides by", () => {
  it("are the payments before the payday, the usual everyday spending and what is left on the last day", () => {
    const out = figures(ahead()).map((f) => plain(`${f.label} ${f.cents}${f.note ? ` (${f.note})` : ""}`));
    // 45 + 142,30 + 1 050 euros of payments, 10 days of 30 euros, 700 euros left
    expect(out).toEqual(["Maksut ennen palkkapäivää 123730", "Ostokset ilman laskuja ja tilauksia 30000 (tavallisesti 30 € päivässä)", "Saldo ennen palkkapäivää 70000"]);
  });

  it("add the payments of the history and the typed-in ones into one figure", () => {
    expect(figures(ahead())[0]).toMatchObject({ key: "bills", cents: 4_500 + 14_230 + 105_000 });
  });

  it("name the last day when no payday sets the window", () => {
    const none = ahead({ reason: "none", payday: null, days: 30, to: "2026-11-11", balance: balance({ last: { date: "2026-11-11", cents: 12_000 } }) });
    expect(figures(none).map((f) => f.label)).toEqual(["Maksut", "Ostokset ilman laskuja ja tilauksia", "Saldo 11.11."]);
  });

  it("leave out the balance without a checking balance and the everyday spending without a complete month", () => {
    const noBalance = ahead({ balance: null, missing: "balance" });
    expect(figures(noBalance).map((f) => f.key)).toEqual(["bills", "everyday"]);
    const noHistory = ahead({ balance: null, missing: "history", everydayPerDayCents: 0, totals: { recurringCents: 0, typedCents: 0, everydayCents: 0, incomeCents: 0, cardCents: 0, transferCents: 0 } }, []);
    expect(figures(noHistory)).toEqual([{ key: "bills", label: "Maksut ennen palkkapäivää", note: null, cents: 0 }]);
  });

  it("have no everyday spending when the window is today alone", () => {
    expect(figures(ahead({ days: 0, to: "2026-10-12" })).map((f) => f.key)).toEqual(["bills", "left"]);
  });
});

describe("the warning", () => {
  it("comes first when the lowest day is under zero", () => {
    const low = balance({ lowest: { date: "2026-10-19", cents: -12_000 } });
    expect(plain(warning(ahead({ balance: low }))!)).toBe("Alin saldo -120 € (ma 19.10.), tili jää miinukselle.");
  });

  it("comes when the lowest day is under a day of everyday spending, with that spending as its basis", () => {
    const low = balance({ lowest: { date: "2026-10-19", cents: 2_500 } });
    expect(plain(warning(ahead({ balance: low }))!)).toBe("Alin saldo 25 € (ma 19.10.), ostoksiin menee tavallisesti 30 € päivässä.");
  });

  it("is not there when the lowest day holds a day of everyday spending, or without a balance", () => {
    expect(warning(ahead({ balance: balance({ lowest: { date: "2026-10-19", cents: 3_000 } }) }))).toBeNull();
    expect(warning(ahead())).toBeNull();
    expect(warning(ahead({ balance: null, missing: "balance" }))).toBeNull();
  });
});

describe("the card", () => {
  it("lists the bills by date, other pay after them and the pay itself last, apart from the list", () => {
    const rows = [...BILLS, row({ date: "2026-10-14", name: "Pieni Esimerkki Oy", cents: 80_000, source: "income" })].sort((a, b) => a.date.localeCompare(b.date));
    const out = html(ahead({}, rows));
    expect(list(out)).toEqual(["Sähköyhtiö Esimerkki", "Esimerkkivakuutus", "Vuokra Esimerkki", "Pieni Esimerkki Oy"]);
    expect(out.indexOf("Esimerkki Oy</a><span")).toBeGreaterThan(out.indexOf("</table>"));
    expect(out).toContain("+3 000,00 €");
    expect(out).toContain("<h2>Palkkapäivä pe 23.10.</h2>");
    expect(out).toContain("Maksut ennen palkkapäivää");
  });

  it("counts one payment and many in the right form and links the list in Laskut", () => {
    expect(html(ahead({}, [row({})]))).toContain("1 maksu ·");
    const many = html(ahead());
    expect(many).toContain("3 maksua ·");
    expect(many).toContain('href="#/bills"');
  });

  it("says what it shows when there is nothing to list", () => {
    const empty = html(ahead({ reason: "none", payday: null, days: 30 }, []));
    expect(empty).toContain("Laskut ja palkkapäivät näkyvät, kun sama maksu on tullut kahdesti.");
    // a payday with no payment before it needs no such sentence: the pay line is there
    expect(html(ahead({}, []))).not.toContain("kun sama maksu on tullut kahdesti");
  });

  it("without a checking balance asks for one, and without a complete month waits for it", () => {
    expect(html(ahead({ balance: null, missing: "balance" }))).toContain("Lisää saldo kohdassa");
    const waiting = html(ahead({ balance: null, missing: "history", everydayPerDayCents: 0 }));
    expect(waiting).toContain("Saldon kehitys näkyy, kun historiassa on yksi valmis kuukausi.");
    expect(waiting).not.toContain("Lähtösaldo");
  });

  it("keeps the start balance in one short note", () => {
    expect(plain(footnote(balance()))).toBe("Lähtösaldo 2 000 €, laskettu pankin saldosta 12.10.2026.");
    expect(plain(footnote(balance({ balanceAt: null })))).toBe("Lähtösaldo 2 000 €.");
  });

  it("names its list for a reader that has no eyes for it", () => {
    expect(listCaption(ahead())).toBe("Maksut ennen palkkapäivää");
    expect(listCaption(ahead({ reason: "none", days: 30 }))).toBe("Maksut seuraavan 30 päivän aikana");
  });
});
