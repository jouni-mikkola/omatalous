/**
 * Raportit > Kiinteät menot: one table of what a month costs before any choice (1.0.0 had it, main deleted it). Each line
 * opens the payments behind it, each payment its day in Tapahtumat; with no series the page says so in one line.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import "@banking/core/late";
import { QUESTIONS } from "@banking/core";
import { PERIOD_FREE_QUESTIONS } from "../src/period.ts";
import { page } from "../src/pages/reports/pages/FixedCosts.tsx";
import { rowsHref, section } from "../src/pages/reports/sections/FixedCosts.tsx";
import type { ReportContext } from "../src/pages/reports/types.ts";
import type { ReportsData } from "../src/types.ts";
import "./fixed-clock.ts";

afterEach(cleanup);

type Report = ReportsData["fixedCosts"];
const pay = (id: string, date: string, amountCents: number) => ({ id, date, amountCents });
const REPORT: Report = {
  rows: [
    { id: "out:acc-1:Sato Oyj", merchant: "Sato Oyj", category: "housing", cadence: "monthly", chargeCents: 105000, monthlyCents: 105000, yearlyCents: 1260000, lastDate: "2026-10-02", nextDate: "2026-11-02", payments: [pay("t2", "2026-10-02", 105000), pay("t1", "2026-09-02", 105000), pay("t0", "2025-11-02", 105000)], paidCents: 315000 },
    { id: "out:acc-1:Apple#1299", merchant: "Apple", category: "subscriptions", cadence: "monthly", chargeCents: 1299, monthlyCents: 1299, yearlyCents: 15588, lastDate: "2026-09-18", nextDate: "2026-10-18", payments: [pay("t3", "2026-09-18", 1299)], paidCents: 1299 },
    { id: "out:acc-1:Apple#99", merchant: "Apple", category: "subscriptions", cadence: "monthly", chargeCents: 99, monthlyCents: 99, yearlyCents: 1188, lastDate: "2026-09-03", nextDate: "2026-10-03", payments: [pay("t4", "2026-09-03", 99)], paidCents: 99 },
  ],
  monthlyCents: 106398,
  yearlyCents: 1276776,
  incomeMonthlyCents: 300000,
  fixedShare: 106398 / 300000,
  fixedShareLabel: "Kiinteät menot tavallisista tuloista, viimeiset 6 kuukautta",
};

const LABELS: Record<string, string> = { housing: "Vuokra ja vastike", subscriptions: "Tilaukset ja suoratoisto" };
const context = (fixedCosts: Report, accounts: unknown[] = [{ id: "acc-1" }]): ReportContext =>
  ({ data: { fixedCosts }, meta: { today: "2026-10-09", accounts, sharedAccounts: [] }, range: { from: "2025-11-01", to: "2026-10-09" }, scope: "own", running: null, label: (id: string) => LABELS[id] ?? id, exportHref: () => "/export.csv" }) as unknown as ReportContext;
const show = (ctx: ReportContext) => render(createElement(section.Component, { ctx }));
const plain = (s: string | null) => (s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();

describe("Raportit: Kiinteät menot", () => {
  it("is in the list of reports after Tulot, as in 1.0.0, and has no period switch: it is about today", () => {
    expect(QUESTIONS.slice(0, 5)).toEqual(["kuukausi", "menot", "tulot", "kiinteat", "velat"]);
    expect(page.title).toBe("Kiinteät menot");
    expect(page.sections).toEqual([section]);
    expect(section.ofToday).toEqual(section.reports);
    expect(PERIOD_FREE_QUESTIONS).toContain("kiinteat");
  });

  it("one table: a line per payment with its month and year, the totals under them and the share of income above", () => {
    show(context(REPORT));
    const table = screen.getByRole("table", { name: "Kiinteät menot kuussa ja vuodessa" });
    expect(within(table).getAllByRole("columnheader").map((h) => plain(h.textContent))).toEqual(["Maksu", "Kategoria", "Kuussa", "Vuodessa"]);
    // the row head starts with the mark of the button that opens the line
    const heads = within(table).getAllByRole("rowheader").map((h) => plain(h.textContent).replace(/^›/, ""));
    // two products of one payee read apart, as on Laskut
    expect(heads).toEqual(["Sato Oyj", "Apple 12,99 €", "Apple 0,99 €", "Yhteensä"]);
    const foot = table.querySelector("tfoot")!;
    expect(plain(foot.textContent)).toContain("1 063,98 €");
    expect(plain(foot.textContent)).toContain("12 767,76 €");
    expect(plain(document.body.textContent)).toContain("1 064 € kuussa, 12 768 € vuodessa");
    expect(plain(document.body.textContent)).toContain("Kiinteät menot tavallisista tuloista, viimeiset 6 kuukautta: 35 % (tulot 3 000 € kuussa).");
  });

  it("a line opens what one charge is and the payments behind it, each a link to its day in Tapahtumat", () => {
    show(context(REPORT));
    fireEvent.click(screen.getByRole("button", { name: "Sato Oyj" }));
    const paid = screen.getByRole("table", { name: "Sato Oyj: maksut 12 kuukauden ajalta" });
    const links = within(paid).getAllByRole("link");
    // newest first; a day of last year keeps its year
    expect(links.map((a) => plain(a.textContent))).toEqual(["2.10.", "2.9.", "2.11.2025"]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "#/transactions?merchant=Sato+Oyj&accountId=acc-1&from=2026-10-02&to=2026-10-02",
      "#/transactions?merchant=Sato+Oyj&accountId=acc-1&from=2026-09-02&to=2026-09-02",
      "#/transactions?merchant=Sato+Oyj&accountId=acc-1&from=2025-11-02&to=2025-11-02",
    ]);
    expect(plain(paid.querySelector("tfoot")!.textContent)).toContain("3 150,00 €");
    expect(screen.getByRole("link", { name: "Avaa Tapahtumissa" }).getAttribute("href")).toBe("#/transactions?merchant=Sato+Oyj&accountId=acc-1");
  });

  it("the rows of a series are its payee's on the account it is charged to", () => {
    expect(rowsHref({ id: "out:acc-2:Elisa", merchant: "Elisa" })).toBe("#/transactions?merchant=Elisa&accountId=acc-2");
    expect(rowsHref({ id: "out:acc-1:Apple#1299", merchant: "Apple" }, "2026-09-18")).toBe("#/transactions?merchant=Apple&accountId=acc-1&from=2026-09-18&to=2026-09-18");
  });

  it("a product among several of its payee links its days only: all the payee's rows would hold the other product's too", () => {
    show(context(REPORT));
    // the price keeps its no-break space before the euro
    fireEvent.click(screen.getByRole("button", { name: /^Apple 12,99\s€$/u }));
    const paid = screen.getByRole("table", { name: /^Apple 12,99\s€: maksut 12 kuukauden ajalta$/u });
    expect(within(paid).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["#/transactions?merchant=Apple&accountId=acc-1&from=2026-09-18&to=2026-09-18"]);
    expect(screen.queryByRole("link", { name: "Avaa Tapahtumissa" })).toBeNull();
  });

  it("is headed by its name in 1.0.0", () => {
    expect(section.title).toBe("Kiinteät menot");
  });

  it("with no series yet it says so in one line, and without accounts it is not listed", () => {
    const none: Report = { rows: [], monthlyCents: 0, yearlyCents: 0, incomeMonthlyCents: null, fixedShare: null, fixedShareLabel: "" };
    expect(section.visible?.(context(none))).toBe(true);
    const { container } = show(context(none));
    expect(container.querySelectorAll("table")).toHaveLength(0);
    expect([...container.querySelectorAll("p")].map((p) => plain(p.textContent))).toEqual(["Toistuvia maksuja ei ole vielä löytynyt."]);
    expect(section.visible?.(context(none, []))).toBe(false);
  });
});
