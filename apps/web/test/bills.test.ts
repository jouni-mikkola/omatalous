import { cancelledSubjects, countingMark, marksBySubject, NO_INPUTS, seriesMarkSubject, type UserMark } from "@banking/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BillsTable, MarkAction } from "../src/components/bills/BillsTable.tsx";
import { billItems } from "../src/components/bills/items.ts";
import type { Recurring } from "../src/types.ts";

const label = (id: string) => ({ utilities: "Sähkö ja vesi", subscriptions: "Tilaukset" })[id] ?? id;
/** The markup with the spaces of the money format made plain, so a test reads "417 €". */
const flat = (html: string) => html.replace(/[\u00a0\u202f]/g, " ");


describe("Laskut: the table and the mark on one subscription", () => {
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
  /** The card as the page builds it: the marks decide which rows are listed as cancelled. */
  const controlsOf = (marks: UserMark[]) => {
    const byCover = marksBySubject(marks);
    return { markOf: (s: Recurring) => countingMark(byCover, s, TODAY), busy: false, set: () => {}, clear: () => {} };
  };
  const cardOf = (rows: Recurring[], marks: UserMark[], cards: ReadonlySet<string> = new Set()) => {
    const byCover = marksBySubject(marks);
    const cancelled = cancelledSubjects({ ...NO_INPUTS, marks });
    const items = billItems({ series: rows, typed: [], cancelled, marks: byCover, today: TODAY });
    return flat(renderToStaticMarkup(createElement(BillsTable, { items, fixedCents: 2398, controls: controlsOf(marks), label, cards, today: TODAY, range: { from: "2026-10-01", to: "2026-10-31" }, scope: "own", onRemoved: () => {} })));
  };
  const action = (s: Recurring, marks: UserMark[], name = s.merchant) => flat(renderToStaticMarkup(createElement(MarkAction, { s, name, controls: controlsOf(marks) })));

  it("is one table with the toolbar, the head's figure is the server's and each series is a row once", () => {
    const out = cardOf([spotify, storage], []);
    expect(out).toContain("Laskut, sopimukset ja tilaukset");
    expect(out).toContain("Spotify");
    const items = billItems({ series: [spotify, storage], typed: [], cancelled: cancelledSubjects({ ...NO_INPUTS, marks: [] }), marks: marksBySubject([]), today: TODAY });
    expect(items.filter((i) => JSON.stringify(i).includes("Spotify"))).toHaveLength(1);
    // a bill typed in that the history found is the same bill: no row of its own, the series' row holds it
    const twin = { id: "b1", name: "spotify", amountCents: 1099, dueDate: "2026-11-03", cadence: "monthly", category: "subscriptions", nextDate: "2026-11-03", counted: true } as never;
    const withTwin = billItems({ series: [spotify, storage], typed: [twin], cancelled: new Set(), marks: marksBySubject([]), today: TODAY });
    expect(withTwin).toHaveLength(2);
    expect(withTwin.find((i) => i.name === "Spotify")!.twins).toEqual([twin]);
    expect(out).toContain("24 €/kk");
  });

  it("with several from one merchant each row says its price in its name", () => {
    const out = cardOf([storage, music], []);
    expect(out).toContain("Apple 7,99");
    expect(out).toContain("Apple 12,99");
  });

  it("says Kortilla on a subscription a credit card pays", () => {
    expect(cardOf([spotify], [], new Set(["acc-1"]))).toContain("Kortilla");
    expect(cardOf([spotify], [])).not.toContain("Kortilla");
  });

  it("a subscription marked as cancelled is an ended row, and one that is not has none", () => {
    const marked = cardOf([spotify], [mark(seriesMarkSubject(spotify), "cancelled")]);
    expect(marked).toContain("Päättyneet <b>1</b>");
    expect(cardOf([spotify], [])).not.toContain("sub-ended");
  });

  it("the one action of a row marks it as cancelled, and a mark that stands is undone under its own subject", () => {
    expect(action(spotify, [])).toContain("Merkitse lopetetuksi: Spotify");
    const marks = [mark(seriesMarkSubject(spotify), "cancelled")];
    expect(action(spotify, marks)).toContain("Kumoa: Spotify");
    expect(action(spotify, marks)).not.toContain("Koskee kaikkia");
    const old = action(storage, [mark("merchant:Apple", "cancelled")]);
    expect(old).toContain("Koskee kaikkia kauppiaan tilauksia.");
    expect(old).toContain('aria-label="Kumoa: Apple"');
  });
});

describe("Laskut adds up nothing", () => {
  it("no file of the page sums money: the totals are core's and the groups' sums come with the answer", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const dir = new URL("../src/components/bills/", import.meta.url);
    const files = [...readdirSync(dir).map((f) => new URL(f, dir)), new URL("../src/pages/Bills.tsx", import.meta.url)];
    for (const file of files) expect(readFileSync(file, "utf8"), String(file)).not.toMatch(/\.reduce\(|\+= *\w*\.?(c|C)ents/);
  });
});
