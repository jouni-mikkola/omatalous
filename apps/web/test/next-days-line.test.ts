import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NextDays } from "../src/components/NextDays.tsx";
import { billLine, endCents, isWeekend, startY, zeroY } from "../src/components/next-days-line.ts";
import type { Ahead } from "../src/components/next-days.ts";

type Row = Ahead["rows"][number];

/** The text as a reader sees it: the spaces inside a sum are plain ones. */
const plain = (s: string) => s.replace(/[  ]/g, " ").replace(/−/g, "-");

const row = (over: Partial<Row>): Row => ({ date: "2026-10-15", name: "Sähköyhtiö Esimerkki", category: "utilities", cents: -4_500, source: "recurring", ...over });
const TYPED = row({ date: "2026-10-20", name: "Vuokra Esimerkki", cents: -105_000, source: "expected" });
const CARD = row({ date: "2026-10-15", name: "Esimerkkipankki Gold (credit)", category: "transfer", cents: -64_230, source: "card", basis: "balance" });

/** Monday 12.10. to the pay on Friday 23.10., a balance of 2 000 euros. */
function ahead(rows: Row[], over: Partial<Ahead> = {}): Ahead {
  const due = rows.filter((r) => r.cents < 0).reduce((s, r) => s - r.cents, 0);
  return {
    from: "2026-10-12",
    to: "2026-10-22",
    days: 10,
    reason: "payday",
    payday: { date: "2026-10-23", name: "Esimerkki Oy", cents: 300_000 },
    rows,
    upcoming: rows.filter((r) => r.cents < 0),
    everydayPerDayCents: 0,
    totals: { recurringCents: 0, typedCents: 0, cardCents: 0, transferCents: 0, dueCents: due, incomeCents: 0 },
    balance: { startCents: 200_000, counts: "all", accounts: 1, balanceAt: "2026-10-12T06:00:00Z", freeCents: 200_000 - due, shortCents: 0, shortOn: null },
    missing: null,
    ...over,
  };
}
const NONE: Partial<Ahead> = { reason: "none", payday: null, days: 30, to: "2026-11-11" };

const html = (a: Ahead) => plain(renderToStaticMarkup(createElement(NextDays, { ahead: a })));
const count = (out: string, what: string) => out.split(what).length - 1;
/** The days of the axis: one list item each. */
const days = (out: string) => (out.slice(out.indexOf("nd-axis")).match(/<li[ >]/g) ?? []).length;
/** The names the dots of the line read out, in the order of the markup. */
const labels = (out: string) => [...out.matchAll(/<span [^>]*class="nd-dot[^"]*"[^>]*>/g)].map((m) => /aria-label="([^"]+)"/.exec(m[0])![1]!);

describe("the days of the line", () => {
  it("run from today to the payday, both days among them, and name the payday", () => {
    const line = billLine(ahead([row({})]))!;
    expect(line.axis).toHaveLength(12);
    expect(line.axis[0]).toEqual({ iso: "2026-10-12", weekday: "ma", day: 12, payday: false, weekend: false });
    expect(line.axis[11]).toEqual({ iso: "2026-10-23", weekday: "pe", day: 23, payday: true, weekend: false });
    expect(line.axis.filter((d) => d.payday)).toHaveLength(1);
  });

  it("run over the 30 days of a window with no payday, none of them the payday", () => {
    const line = billLine(ahead([row({})], NONE))!;
    expect(line.axis).toHaveLength(31);
    expect(line.axis.at(-1)!.iso).toBe("2026-11-11");
    expect(line.axis.some((d) => d.payday)).toBe(false);
  });

  it("are two when the pay is tomorrow and one when it is today, with the payment of today on the first", () => {
    const tomorrow = ahead([row({ date: "2026-10-12" })], { to: "2026-10-12", days: 0, payday: { date: "2026-10-13", name: "Esimerkki Oy", cents: 300_000 } });
    expect(billLine(tomorrow)!.axis.map((d) => [d.day, d.payday])).toEqual([
      [12, false],
      [13, true],
    ]);
    expect(billLine(tomorrow)!.bills[0]!.column).toBe(0);
    expect(billLine(tomorrow)!.pays.map((p) => p.column)).toEqual([1]);
    const today = ahead([row({ date: "2026-10-12" })], { to: "2026-10-12", days: 0, payday: { date: "2026-10-12", name: "Esimerkki Oy", cents: 300_000 } });
    expect(billLine(today)!.axis.map((d) => [d.day, d.payday])).toEqual([[12, true]]);
    expect(billLine(today)!.pays.map((p) => p.column)).toEqual([0]);
  });

  it("have no line when no payment is due, whatever else the window holds", () => {
    expect(billLine(ahead([]))).toBeNull();
    expect(billLine(ahead([row({ date: "2026-10-14", name: "Pieni Esimerkki Oy", cents: 80_000, source: "income" })]))).toBeNull();
    expect(billLine(ahead([], NONE))).toBeNull();
  });

  it("put a pay that is behind its day on no day: it is not on the axis, and its row is in the table", () => {
    const behind = ahead([row({})], { to: "2026-11-05", days: 24, payday: { date: "2026-10-12", expected: "2026-10-09", next: "2026-11-06", name: "Esimerkki Oy", cents: 300_000 } });
    const line = billLine(behind)!;
    expect(line.axis.at(-1)).toMatchObject({ iso: "2026-11-06", payday: true });
    expect(line.pays).toEqual([]);
  });
});

describe("the weekend of the axis", () => {
  it("is Saturday and Sunday and no other day", () => {
    const axis = billLine(ahead([row({})]))!.axis;
    expect(axis.filter((d) => d.weekend).map((d) => d.iso)).toEqual(["2026-10-17", "2026-10-18"]);
    expect(isWeekend("2026-10-16")).toBe(false);
    expect(isWeekend("2026-10-19")).toBe(false);
  });
});

describe("the scale of the steps", () => {
  it("ends at the balance less every payment, and has no end without a balance", () => {
    const line = billLine(ahead([row({}), TYPED]))!;
    expect(endCents(line)).toBe(200_000 - 4_500 - 105_000);
    expect(endCents(billLine(ahead([row({})], { balance: null }))!)).toBeNull();
    // a pay is a mark and is never added
    expect(endCents(billLine(ahead([row({}), row({ date: "2026-10-16", cents: 50_000, source: "income" })]))!)).toBe(200_000 - 4_500);
  });
  it("reads the start's height from the path, and only from a path that begins so", () => {
    expect(startY("M0,12.5H40V30")).toBe(12.5);
    expect(startY("M0,7H40")).toBe(7);
    expect(startY("H40")).toBeNull();
  });
  it("puts zero where the straight scale crosses it, only when a step goes below it and inside the field", () => {
    // 1 000 at y 10 down to -1 000 at y 90: zero is in the middle
    expect(zeroY(100_000, -100_000, 10, 90, 96)).toBe(50);
    // a step that stops exactly at zero is not below it
    expect(zeroY(100_000, 0, 10, 90, 96)).toBeNull();
    expect(zeroY(100_000, 50_000, 10, 50, 96)).toBeNull();
    expect(zeroY(100_000, 100_000, 10, 10, 96)).toBeNull();
    // one cent under: zero is drawn, at the foot of the scale
    expect(zeroY(100_000, -1, 10, 90, 96)).toBeCloseTo(90, 0);
    // outside the field
    expect(zeroY(100_000, -100_000, 10, 200, 96)).toBeNull();
  });
});

describe("the marks of the block", () => {
  it("names the days it covers in the title block", () => {
    expect(html(ahead([row({})]))).toContain('<div class="card-datum">12.10.–22.10.</div>');
  });
  it("measures the days to the payday on a dimension line, and only when the window ends at a payday", () => {
    expect(html(ahead([row({})]))).toContain("<span>11 pv</span>");
    expect(html(ahead([row({})], NONE))).not.toContain("nd-dim");
  });
  it("gives a weekend column its band, the steps their two values and the zero line only when a step is below zero", () => {
    const out = html(ahead([row({})]));
    expect(count(out, 'class="nd-we"')).toBe(2);
    expect(out).toContain(">1 955 €<");
    expect(out).not.toContain(">0 €<");
    const short = html(ahead([row({ cents: -250_000 })]));
    expect(short).toContain(">0 €<");
    // no balance, no scale
    expect(html(ahead([row({})], { balance: null }))).not.toContain("nd-val");
  });
  it("shows the shape of the source: a disc for a typed bill, a ring for an estimate, and the sentence only while a ring is shown", () => {
    const typed = html(ahead([TYPED]));
    expect(typed).toContain('<span class="src" aria-hidden="true"></span>20.10.');
    expect(typed).not.toContain("Eräpäivät ja summat ovat arvioita.");
    const mixed = html(ahead([TYPED, row({})]));
    expect(mixed).toContain('<span class="src src-est" aria-hidden="true"></span>15.10.');
    expect(mixed).toContain("Eräpäivät ja summat ovat arvioita.");
  });
});

describe("a dot's name", () => {
  it("is the payee, the sum and the day; an estimate says so with the word the page uses, a typed bill does not", () => {
    const line = billLine(ahead([row({}), row({ date: "2026-10-16", name: "Esimerkkivakuutus", cents: -14_230, source: "recurring" }), TYPED]))!;
    expect(line.bills.map((b) => plain(b.label))).toEqual(["Sähköyhtiö Esimerkki, arvio, 45,00 €, to 15.10.", "Esimerkkivakuutus, arvio, 142,30 €, pe 16.10.", "Vuokra Esimerkki, 1 050,00 €, ti 20.10."]);
    expect(line.bills.map((b) => b.estimate)).toEqual([true, true, false]);
    expect(line.bills.map((b) => plain(b.when))).toEqual(["to 15.10. · 45,00 € · arvio", "pe 16.10. · 142,30 € · arvio", "ti 20.10. · 1 050,00 €"]);
  });

  it("tells what is estimated by the source of the row: a bill of the history, a regular transfer and a card's usual bill are, a typed bill and what a card owes today are not", () => {
    const rows = [
      row({ source: "recurring" }),
      row({ source: "expected" }),
      row({ source: "transfer", name: "Säästötili Esimerkki", category: "transfer" }),
      row({ source: "card", name: "Kortti Esimerkki", basis: "usual" }),
      row({ source: "card", name: "Kortti Esimerkki", basis: "balance" }),
      row({ source: "card", name: "Kortti Esimerkki" }),
    ];
    expect(billLine(ahead(rows))!.bills.map((b) => b.estimate)).toEqual([true, false, true, true, false, true]);
  });

  it("uses the plain name of a card, as Varallisuus does", () => {
    expect(billLine(ahead([CARD]))!.bills[0]).toMatchObject({ name: "Esimerkkipankki Gold", estimate: false });
    expect(plain(billLine(ahead([CARD]))!.bills[0]!.label)).toBe("Esimerkkipankki Gold, 642,30 €, to 15.10.");
  });

  it("of a pay says it arrives and tells no estimate", () => {
    const line = billLine(ahead([row({})]))!;
    expect(plain(line.pays[0]!.label)).toBe("Saapuva maksu, Esimerkki Oy, 3 000,00 €, pe 23.10.");
  });
});

describe("what is left after a payment", () => {
  it("is the balance less the payments up to the end of the day: the payments of one day are told alike", () => {
    const line = billLine(ahead([CARD, row({ name: "As Oy Esimerkkikuja", cents: -28_600 }), TYPED]))!;
    expect(line.startCents).toBe(200_000);
    expect(line.bills.map((b) => b.leftCents)).toEqual([200_000 - 64_230 - 28_600, 200_000 - 64_230 - 28_600, 200_000 - 64_230 - 28_600 - 105_000]);
  });

  it("is not told without a balance, and the line has no steps then", () => {
    const a = ahead([row({})], { balance: null, missing: "balance" });
    expect(billLine(a)!.bills[0]!.leftCents).toBeNull();
    expect(billLine(a)!.startCents).toBeNull();
    const out = html(a);
    expect(out).toContain("nd-dots");
    expect(out).not.toContain("nd-steps");
  });

  it("goes below zero when the payments pass the balance, and stops at the balance when they equal it", () => {
    const short = ahead([TYPED], { balance: { startCents: 50_000, counts: "all", accounts: 1, balanceAt: null, freeCents: -55_000, shortCents: 55_000, shortOn: "2026-10-20" } });
    expect(billLine(short)!.bills[0]!.leftCents).toBe(-55_000);
    const exact = ahead([TYPED], { balance: { startCents: 105_000, counts: "all", accounts: 1, balanceAt: null, freeCents: 0, shortCents: 0, shortOn: null } });
    expect(billLine(exact)!.bills[0]!.leftCents).toBe(0);
  });
});

describe("the line as the page shows it", () => {
  it("has a dot for each payment and a mark for the pay, a hollow dot for each estimate, and the names are read out", () => {
    const out = html(ahead([row({}), CARD, TYPED]));
    expect(count(out, 'class="nd-dot ')).toBe(4);
    expect(count(out, "nd-pay")).toBe(1);
    // the typed bill and the card's own sum are full dots, the bill of the history is hollow
    expect(count(out, " nd-est")).toBe(1);
    expect(labels(out)).toEqual(["Sähköyhtiö Esimerkki, arvio, 45,00 €, to 15.10.", "Esimerkkipankki Gold, 642,30 €, to 15.10.", "Vuokra Esimerkki, 1 050,00 €, ti 20.10.", "Saapuva maksu, Esimerkki Oy, 3 000,00 €, pe 23.10."]);
  });

  it("is one tab stop, the first dot: the arrows go on from there", () => {
    const out = html(ahead([row({}), TYPED]));
    expect(count(out, 'tabindex="0"')).toBe(1);
    expect(count(out, 'tabindex="-1"')).toBe(2);
    expect(out.indexOf('tabindex="0"')).toBeLessThan(out.indexOf('tabindex="-1"'));
  });

  it("is a group named by the heading of the block, with an axis of days that a reader without eyes skips, and no new sentence", () => {
    const out = html(ahead([row({})]));
    expect(out).toContain('role="group" aria-labelledby="ahead-h"');
    expect(out).toContain('<ol class="nd-axis" aria-hidden="true"');
    expect(count(out, "<h2")).toBe(1);
    expect(count(out, "<h3")).toBe(1);
    expect(count(out, "arvioita")).toBe(1);
  });

  it("with the usual two bills, one of them a card's, is a whole line: both dots, the axis to the payday and the balance in steps", () => {
    const out = html(ahead([CARD, row({ date: "2026-10-19", name: "Puhelin Esimerkki Oy", cents: -4_490 })]));
    expect(count(out, 'class="nd-dot ')).toBe(3);
    expect(out).toContain("nd-steps");
    expect(days(out)).toBe(12);
    // one bill alone is as whole
    const one = html(ahead([CARD]));
    expect(count(one, 'class="nd-dot ')).toBe(2);
    expect(one).toContain("nd-steps");
    expect(one).toContain('class="nd-axis"');
  });

  it("with twenty bills on one day has twenty dots, each with its name", () => {
    const out = html(ahead(Array.from({ length: 20 }, (_, i) => row({ name: `Laskuttaja Esimerkki ${i + 1}`, cents: -(1_000 + i * 100) }))));
    expect(labels(out).filter((l) => l.startsWith("Laskuttaja Esimerkki"))).toHaveLength(20);
  });

  it("with a sum so large that it passes any figure keeps the line whole: the largest dot, the sum written out", () => {
    const out = html(ahead([row({ cents: -99_999_999_999_900 }), row({ date: "2026-10-16", cents: -4_500 })], { balance: null, missing: "balance" }));
    expect(count(out, 'class="nd-dot ')).toBe(3);
    expect(out).not.toContain("NaN");
    expect(out).not.toContain("Infinity");
  });

  it("with a payday that is not known runs over the month, and the block still says so", () => {
    const out = html(ahead([row({})], NONE));
    expect(out).toContain("Palkkapäivä ei ole tiedossa.");
    expect(days(out)).toBe(31);
  });
});
