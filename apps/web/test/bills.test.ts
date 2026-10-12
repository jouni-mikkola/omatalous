import { countingMark, marksBySubject, seriesMarkSubject, type UserMark } from "@banking/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Coming } from "../src/components/bills/Coming.tsx";
import { Subscriptions } from "../src/components/bills/Subscriptions.tsx";
import { NextDays } from "../src/components/NextDays.tsx";
import type { DashboardData, Recurring } from "../src/types.ts";

type Ahead = NonNullable<DashboardData["ahead"]>;
type Row = Ahead["rows"][number];

const sum = (rows: Row[], source: Row["source"]) => rows.filter((r) => r.source === source).reduce((total, r) => total + Math.abs(r.cents), 0);
const row = (over: Partial<Row>): Row => ({ date: "2026-10-15", name: "Palkka", category: "salary", cents: 395_000, source: "income", ...over });
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
  totals: { recurringCents: sum(rows, "recurring"), typedCents: sum(rows, "expected"), everydayCents: 0, incomeCents: sum(rows, "income") },
  balance: null,
  missing: "balance",
});

const label = (id: string) => ({ utilities: "Sähkö ja vesi", subscriptions: "Tilaukset" })[id] ?? id;
/** The markup with the spaces of the money format made plain, so a test reads "417 €". */
const flat = (html: string) => html.replace(/[\u00a0\u202f]/g, " ");
const coming = (a: Ahead | null) => flat(renderToStaticMarkup(createElement(Coming, { ahead: a, today: "2026-10-11", label, onAdded: () => {} })));
const nextDays = (a: Ahead) => flat(renderToStaticMarkup(createElement(NextDays, { ahead: a })));

describe("Laskut: Tulossa", () => {
  it("lists the bills of the next 30 days in one list, the typed-in one marked, and no pay day", () => {
    const out = coming(ahead());
    expect(out).toContain("Seuraavat 30 päivää, 3 maksua");
    for (const name of ["Sähkö", "Netflix", "Ajoneuvovero"]) expect(out).toContain(name);
    expect(out).toContain("lisätty käsin");
    expect(out).not.toContain("Palkka");
    // the dates in the order the rows come, and the amounts as bills (no minus)
    expect(out.indexOf("Sähkö")).toBeLessThan(out.indexOf("Netflix"));
    expect(out).toContain("12.10.");
  });

  it("its sum is the Maksut of Kuukausi's Seuraavat 30 päivää: one list, one total", () => {
    const rows = ahead();
    // 89 + 15,99 + 312,50
    expect(coming(rows)).toContain("<strong>417 €</strong>");
    expect(nextDays(rows)).toContain("<dt>Maksut</dt><dd>417 €</dd>");
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

describe("Kuukausi: Seuraavat 30 päivää", () => {
  it("lists the bills before the pay and links to Laskut", () => {
    const out = nextDays(ahead());
    expect(out).toContain("<h2>Seuraavat 30 päivää</h2>");
    for (const name of ["Sähkö", "Netflix", "Ajoneuvovero"]) expect(out).toContain(name);
    expect(out.indexOf("Ajoneuvovero")).toBeLessThan(out.indexOf(">Palkka</a>"));
    expect(out).toContain('href="#/bills"');
    expect(out).toContain("3 maksua");
    expect(out).not.toContain("Näytä kaikki");
  });

  it("has no link while there is no bill to show", () => {
    expect(nextDays(ahead([row({})]))).not.toContain('href="#/bills"');
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
    expect(marked).toContain("<strong>24 €/kk</strong>");
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
});
