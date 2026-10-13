import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NextDays } from "../src/components/NextDays.tsx";
import { type Ahead, figures, incoming, payments } from "../src/components/next-days.ts";
import { steady } from "./pay-fixture.ts";

type Row = Ahead["rows"][number];
type Balance = NonNullable<Ahead["balance"]>;

/** The text as a reader sees it: the spaces inside a sum are plain ones. */
const plain = (s: string) => s.replace(/[  ]/g, " ").replace(/−/g, "-");

const row = (over: Partial<Row>): Row => ({ date: "2026-10-15", name: "Sähköyhtiö Esimerkki", category: "utilities", cents: -4_500, source: "recurring", ...over });
const CARD = row({ date: "2026-10-18", name: "Esimerkkipankki Gold", category: "transfer", cents: -65_000, source: "card", basis: "balance" });
const MOVE = row({ date: "2026-10-20", name: "Yhteistili", category: "transfer", cents: -60_000, source: "transfer" });
const ALL: Row[] = [
  row({}),
  row({ date: "2026-10-16", name: "Vuokra Esimerkki", cents: -105_000, source: "expected" }),
  CARD,
  MOVE,
  row({ date: "2026-10-21", name: "Pieni Esimerkki Oy", category: "income", cents: 20_000, source: "income", pay: steady(20_000) }),
];

const balance = (over: Partial<Balance> = {}): Balance => ({ startCents: 300_000, counts: "all", accounts: 1, balanceAt: "2026-10-12T06:00:00Z", freeCents: 65_500, shortCents: 0, shortOn: null, ...over });

/** A window as core gives it: its totals are the sums of the rows by source, and what is due is the four kinds of payment. */
function ahead(rows: Row[] = ALL, over: Partial<Ahead> = {}): Ahead {
  const sum = (source: Row["source"]) => rows.filter((r) => r.source === source).reduce((s, r) => s + Math.abs(r.cents), 0);
  const dueCents = sum("recurring") + sum("expected") + sum("card") + sum("transfer");
  return {
    from: "2026-10-12",
    to: "2026-10-22",
    days: 10,
    reason: "payday",
    payday: { date: "2026-10-23", name: "Esimerkki Oy", pay: steady(300_000) },
    rows,
    upcoming: rows.filter((r) => r.source === "recurring" || r.source === "expected"),
    everydayPerDayCents: 3_000,
    totals: { recurringCents: sum("recurring"), typedCents: sum("expected"), cardCents: sum("card"), transferCents: sum("transfer"), dueCents, incomeCents: sum("income") },
    balance: balance({ freeCents: 300_000 - dueCents }),
    missing: null,
    ...over,
  };
}

const html = (a: Ahead) => plain(renderToStaticMarkup(createElement(NextDays, { ahead: a })));

describe("every kind of row has its words", () => {
  // a source core adds has no entry here, and the file no longer compiles: the page cannot get a row without its words
  const SOURCES: Record<Row["source"], Row> = { income: ALL[4]!, recurring: ALL[0]!, expected: ALL[1]!, card: CARD, transfer: MOVE };
  /** The one line the page makes of a row, in whichever table it lands. */
  const lineOf = (r: Row) => [...payments(ahead([r])), ...incoming(ahead([r], { reason: "none", payday: null }))][0]!;

  it("every row goes by its name, whatever it is", () => {
    expect(Object.values(SOURCES).map((r) => lineOf(r).name)).toEqual(["Pieni Esimerkki Oy", "Sähköyhtiö Esimerkki", "Vuokra Esimerkki", "Esimerkkipankki Gold", "Yhteistili"]);
  });

  it("a card's bill and an own transfer say what they are under the name, the rest say nothing", () => {
    expect(lineOf(CARD).note).toBe("Luottokortin lasku");
    expect(lineOf({ ...CARD, basis: "usual" }).note).toBe("Luottokortin lasku, arvio aiemmista laskuista");
    // a card row with no basis is the usual bill: the estimate is never left unsaid
    expect(lineOf({ ...CARD, basis: undefined }).note).toBe("Luottokortin lasku, arvio aiemmista laskuista");
    expect(lineOf(MOVE).note).toBe("Oma siirto");
    for (const source of ["income", "recurring", "expected"] as const) expect(lineOf(SOURCES[source]).note, source).toBeNull();
  });

  it("the name of a card or of an account is no merchant of Tapahtumat, any other row's name is", () => {
    expect(lineOf(CARD).merchant).toBeNull();
    expect(lineOf(MOVE).merchant).toBeNull();
    for (const source of ["income", "recurring", "expected"] as const) expect(lineOf(SOURCES[source]).merchant, source).toBe(SOURCES[source].name);
  });

  it("a payment is a row of the payments and pay a row of what is to arrive, each with its sum as a positive figure", () => {
    expect(payments(ahead()).map((l) => l.cents)).toEqual([4_500, 105_000, 65_000, 60_000]);
    expect(incoming(ahead()).map((l) => [l.name, l.cents])).toEqual([
      ["Pieni Esimerkki Oy", 20_000],
      ["Esimerkki Oy", 300_000],
    ]);
  });
});

describe("the figure of what is due is what core totals", () => {
  it("holds the four kinds of payment and no pay, and what is free is core's own figure", () => {
    const a = ahead();
    const [, due, free] = figures(a)!;
    expect(due!.cents).toBe(4_500 + 105_000 + 65_000 + 60_000);
    // 3 000,00 - 2 345,00 = 655,00: the 200,00 of other pay is in neither figure
    expect(free!.cents).toBe(65_500);
  });

  it("is the sum of the listed payments, a card's bill and a transfer among them", () => {
    const out = html(ahead());
    const table = out.slice(out.indexOf("<table"), out.indexOf("</table>"));
    const listed = [...table.matchAll(/<td class="st-num">([\d ]+,\d\d) €<\/td>/g)].map((m) => Math.round(Number(m[1]!.replace(/ /g, "").replace(",", ".")) * 100));
    expect(listed).toHaveLength(4);
    expect(listed.reduce((s, c) => s + c, 0)).toBe(figures(ahead())![1]!.cents);
  });

  it("a household with no card's bill and no transfer has the figure of its bills", () => {
    expect(figures(ahead([ALL[0]!, ALL[1]!]))![1]!.cents).toBe(4_500 + 105_000);
  });
});

describe("the tables on the page", () => {
  it("show the card's bill and the transfer by name with their lines and no link to Tapahtumat, a bill with its link", () => {
    const out = html(ahead());
    expect(out).toContain('<td title="Esimerkkipankki Gold">Esimerkkipankki Gold<div class="st-sub">Luottokortin lasku</div></td>');
    expect(out).toContain('<td title="Yhteistili">Yhteistili<div class="st-sub">Oma siirto</div></td>');
    expect(out).not.toContain("merchant=Esimerkkipankki");
    expect(out).not.toContain("merchant=Yhteistili");
    expect(out).toContain("merchant=S%C3%A4hk%C3%B6yhti%C3%B6");
    expect(html(ahead([{ ...CARD, basis: "usual" }]))).toContain("Luottokortin lasku, arvio aiemmista laskuista");
  });
});

describe("the line under Saldo says which accounts the balance counts", () => {
  const notes = (over: Partial<Balance>) => figures(ahead(ALL, { balance: balance(over) }))![0]!.notes;

  it("says nothing of the accounts when the one checking account in view is counted", () => {
    expect(notes({ counts: "all", accounts: 1 })).toEqual([]);
  });

  it("says how many when every checking account in view is counted and there are several", () => {
    expect(notes({ counts: "all", accounts: 2 })).toEqual(["2 käyttötiliä"]);
    expect(notes({ counts: "all", accounts: 3 })).toEqual(["3 käyttötiliä"]);
  });

  it("says the joint account is left out when the viewer's own accounts are counted", () => {
    expect(notes({ counts: "own" })).toEqual(["Omat käyttötilit, ilman yhteistä tiliä"]);
    expect(notes({ counts: "own", accounts: 2 })).toEqual(["Omat käyttötilit, ilman yhteistä tiliä"]);
  });

  it("says only the viewer's part of a joint account is counted when no account is theirs alone, and an old balance says its day after it", () => {
    expect(notes({ counts: "part" })).toEqual(["Osuutesi yhteisestä tilistä"]);
    expect(notes({ counts: "part", balanceAt: "2026-10-09T06:00:00Z" })).toEqual(["Osuutesi yhteisestä tilistä", "Saldo päivältä 9.10.2026"]);
  });

  it("shows the line on the page, in the row of Saldo", () => {
    expect(html(ahead(ALL, { balance: balance({ counts: "part" }) }))).toContain('<dt class="st-name">Saldo</dt><dd class="st-num">3 000,00 €</dd><dd class="st-sub">Osuutesi yhteisestä tilistä</dd>');
    expect(html(ahead())).not.toContain("osuutesi");
    expect(html(ahead())).not.toContain("Osuutesi");
  });
});
