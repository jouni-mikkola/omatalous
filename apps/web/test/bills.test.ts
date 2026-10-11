import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Coming } from "../src/components/bills/Coming.tsx";
import { NextDays } from "../src/components/NextDays.tsx";
import type { DashboardData } from "../src/types.ts";

type Ahead = NonNullable<DashboardData["ahead"]>;
type Row = Ahead["rows"][number];

const row = (over: Partial<Row>): Row => ({ date: "2026-10-15", name: "Palkka", category: "salary", cents: 395_000, source: "income", ...over });
/** A 30-day answer as the dashboard gives it: a pay day, two bills of the history and one the household typed in. */
const ahead = (rows: Row[] = [row({}), row({ date: "2026-10-12", name: "Sähkö", category: "utilities", cents: -8_900, source: "recurring" }), row({ date: "2026-10-20", name: "Netflix", category: "subscriptions", cents: -1_599, source: "recurring" }), row({ date: "2026-11-03", name: "Ajoneuvovero", category: null, cents: -31_250, source: "expected" })]): Ahead => ({
  from: "2026-10-11",
  to: "2026-11-10",
  rows,
  everydayPerDayCents: 0,
  everydayCents: 0,
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

  it("its sum is the Menoja of Kuukausi's Seuraavat 30 päivää: one list, one total", () => {
    const rows = ahead();
    // 89 + 15,99 + 312,50
    expect(coming(rows)).toContain("<strong>417 €</strong>");
    expect(nextDays(rows)).toContain("Menoja 417 €");
  });

  it("offers the form behind Lisää lasku and not before", () => {
    const out = coming(ahead());
    expect(out).toContain("Lisää lasku");
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain("Lisää odotettu lasku");
  });

  it("without bills or a dashboard answer it still opens the form", () => {
    expect(coming(ahead([row({})]))).toContain("Ei laskuja seuraavan 30 päivän aikana.");
    expect(coming(null)).toContain("Lisää lasku");
  });
});

describe("Kuukausi: Seuraavat 30 päivää", () => {
  it("keeps its totals and the pay day, lists no bill and links to Laskut", () => {
    const out = nextDays(ahead());
    expect(out).toContain("Menoja 417 €, tuloja 3 950 €");
    expect(out).toContain("Palkka");
    for (const name of ["Sähkö", "Netflix", "Ajoneuvovero"]) expect(out).not.toContain(name);
    expect(out).toContain('href="#/bills"');
    expect(out).toContain("3 maksua");
    expect(out).not.toContain("Näytä kaikki");
  });

  it("has no link while there is no bill to show", () => {
    expect(nextDays(ahead([row({})]))).not.toContain('href="#/bills"');
  });
});
