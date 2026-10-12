import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NextDays } from "../src/components/NextDays.tsx";
import { type Ahead, figures, footnote, isMerchant, rowLabel, rowNote } from "../src/components/next-days.ts";

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
  row({ date: "2026-10-21", name: "Esimerkki Oy", category: "income", cents: 20_000, source: "income" }),
];

const balance = (over: Partial<Balance> = {}): Balance => ({
  startCents: 300_000,
  counts: "all",
  accounts: 1,
  balanceAt: "2026-10-12T06:00:00Z",
  days: [
    { date: "2026-10-12", cents: 300_000 },
    { date: "2026-10-22", cents: 0 },
  ],
  last: { date: "2026-10-22", cents: 0 },
  lowest: { date: "2026-10-22", cents: 0 },
  ...over,
});

/** A window as core gives it: its totals are the sums of the rows by source, and start + income - payments - everyday ends at the last balance. */
function ahead(rows: Row[] = ALL, over: Partial<Ahead> = {}): Ahead {
  const sum = (source: Row["source"]) => rows.filter((r) => r.source === source).reduce((s, r) => s + Math.abs(r.cents), 0);
  return {
    from: "2026-10-12",
    to: "2026-10-22",
    days: 10,
    reason: "payday",
    payday: { date: "2026-10-23", name: "Esimerkki Oy", cents: 300_000 },
    rows,
    upcoming: rows.filter((r) => r.source === "recurring" || r.source === "expected"),
    everydayPerDayCents: 3_000,
    totals: { recurringCents: sum("recurring"), typedCents: sum("expected"), cardCents: sum("card"), transferCents: sum("transfer"), everydayCents: 30_000, incomeCents: sum("income") },
    balance: balance(),
    missing: null,
    ...over,
  };
}

const html = (a: Ahead) => plain(renderToStaticMarkup(createElement(NextDays, { ahead: a })));

describe("every kind of row has its line", () => {
  const SOURCES: Record<Row["source"], Row> = { income: ALL[4]!, recurring: ALL[0]!, expected: ALL[1]!, card: CARD, transfer: MOVE };

  it("a pay, a subscription and a typed bill go by their name, a card's bill and a transfer say what they are", () => {
    expect(Object.keys(SOURCES).map((s) => rowLabel(SOURCES[s as Row["source"]]))).toEqual(["Esimerkki Oy", "Sähköyhtiö Esimerkki", "Vuokra Esimerkki", "Korttilasku (Esimerkkipankki Gold)", "Siirto tilille (Yhteistili)"]);
  });

  it("only a card's bill tells where its sum comes from", () => {
    expect(rowNote(CARD)).toBe("Käytetty luotto tänään");
    expect(rowNote({ ...CARD, basis: "usual" })).toBe("Arvio aiemmista laskuista");
    // a card row with no basis is the usual bill: the estimate is never left unsaid
    expect(rowNote({ ...CARD, basis: undefined })).toBe("Arvio aiemmista laskuista");
    for (const source of ["income", "recurring", "expected", "transfer"] as const) expect(rowNote(SOURCES[source])).toBeNull();
  });

  it("a card's or an account's name is no merchant of Tapahtumat, any other row's name is", () => {
    expect(isMerchant(CARD)).toBe(false);
    expect(isMerchant(MOVE)).toBe(false);
    for (const source of ["income", "recurring", "expected"] as const) expect(isMerchant(SOURCES[source])).toBe(true);
  });
});

describe("the figure of the payments is what core totals", () => {
  it("holds the four kinds, so the start, the pay, the payments and the everyday spending end at the last balance", () => {
    // 3 000,00 + 200,00 - 2 345,00 - 300,00 = 555,00, the balance core gives for the last day of this window
    const a = ahead(ALL, { balance: balance({ last: { date: "2026-10-22", cents: 55_500 } }) });
    const bills = figures(a).find((f) => f.key === "bills")!.cents;
    expect(bills).toBe(4_500 + 105_000 + 65_000 + 60_000);
    const { incomeCents, everydayCents } = a.totals;
    expect(a.balance!.startCents + incomeCents - bills - everydayCents).toBe(a.balance!.last.cents);
    expect(figures(a).find((f) => f.key === "left")!.cents).toBe(55_500);
  });

  it("is the sum of the listed payments, a card's bill and a transfer among them", () => {
    const out = html(ahead());
    const listed = [...out.matchAll(/<td class="num">([\d ]+,\d\d €)<\/td>/g)].map((m) => Number(m[1]!.replace(/[ €]/g, "").replace(",", ".")) * 100);
    expect(listed.reduce((s, c) => s + c, 0)).toBe(figures(ahead()).find((f) => f.key === "bills")!.cents);
  });

  it("a household with no card's bill and no transfer has the figure it had", () => {
    const rows = [ALL[0]!, ALL[1]!];
    expect(figures(ahead(rows)).find((f) => f.key === "bills")!.cents).toBe(4_500 + 105_000);
  });
});

describe("the list on the page", () => {
  it("shows the card's bill and the transfer with their lines and no link to Tapahtumat, a bill with its link", () => {
    const out = html(ahead());
    expect(out).toContain("Korttilasku (Esimerkkipankki Gold)");
    expect(out).toContain("Siirto tilille (Yhteistili)");
    expect(out).toContain("Käytetty luotto tänään");
    expect(out).not.toContain("merchant=Esimerkkipankki");
    expect(out).not.toContain("merchant=Yhteistili");
    expect(out).toContain('merchant=S%C3%A4hk%C3%B6yhti%C3%B6');
  });
});

describe("the foot says which accounts the balance counts", () => {
  it("says nothing of the accounts when every checking account in view is counted", () => {
    expect(plain(footnote(balance({ counts: "all" })))).toBe("Lähtösaldo 3 000 €, laskettu pankin saldosta 12.10.2026.");
  });

  it("says the joint accounts are left out when the viewer's own accounts are counted", () => {
    expect(plain(footnote(balance({ counts: "own" })))).toBe("Lähtösaldo 3 000 €, laskettu pankin saldosta 12.10.2026. Yhteiset tilit eivät ole mukana.");
  });

  it("says only the viewer's part of a joint account is counted when no account is theirs alone", () => {
    expect(plain(footnote(balance({ counts: "part", balanceAt: null })))).toBe("Lähtösaldo 3 000 €. Mukana on vain osuutesi yhteisestä tilistä.");
  });

  it("shows the sentence on the page, under the card", () => {
    expect(html(ahead(ALL, { balance: balance({ counts: "part" }) }))).toContain("Mukana on vain osuutesi yhteisestä tilistä.");
    expect(html(ahead())).not.toContain("osuutesi");
  });
});
