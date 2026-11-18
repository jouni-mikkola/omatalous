import { cancelledSubjects, countingMark, marksBySubject, NO_INPUTS, seriesMarkSubject, type UserMark } from "@banking/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BillsTable, MarkAction } from "../src/components/bills/BillsTable.tsx";
import { billItems } from "../src/components/bills/items.ts";
import type { Calendar } from "../src/components/bills/calendar-rows.ts";
import type { Recurring } from "../src/types.ts";
import { bill, calendar, month } from "./bill-calendar-fixture.ts";

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
  const cardOf = (rows: Recurring[], marks: UserMark[], cal: Calendar = calendar([month("2026-10", [])])) => {
    const byCover = marksBySubject(marks);
    const cancelled = cancelledSubjects({ ...NO_INPUTS, marks });
    const items = billItems({ series: rows, typed: [], cancelled, marks: byCover, today: TODAY });
    return flat(renderToStaticMarkup(createElement(BillsTable, { calendar: cal, items, controls: controlsOf(marks), label, scope: "own", onRemoved: () => {} })));
  };
  const action = (s: Recurring, marks: UserMark[], name = s.merchant) => flat(renderToStaticMarkup(createElement(MarkAction, { s, name, controls: controlsOf(marks) })));

  it("is one table with no link to a report, and each series is an item once", () => {
    const out = cardOf([spotify, storage], [], calendar([month("2026-10", [bill({ date: "2026-10-20", payee: "Spotify", cents: 1099, seriesId: spotify.id })])]));
    expect(out).toContain("Laskut, sopimukset ja tilaukset");
    expect(out).not.toContain("Kiinteät menot");
    expect(out).toContain("Spotify");
    const items = billItems({ series: [spotify, storage], typed: [], cancelled: cancelledSubjects({ ...NO_INPUTS, marks: [] }), marks: marksBySubject([]), today: TODAY });
    expect(items.filter((i) => JSON.stringify(i).includes("Spotify"))).toHaveLength(1);
    // a bill typed in that the history found is the same bill: no row of its own, the series' row holds it
    const twin = { id: "b1", name: "spotify", amountCents: 1099, dueDate: "2026-11-03", cadence: "monthly", category: "subscriptions", nextDate: "2026-11-03", counted: true } as never;
    const withTwin = billItems({ series: [spotify, storage], typed: [twin], cancelled: new Set(), marks: marksBySubject([]), today: TODAY });
    expect(withTwin).toHaveLength(2);
    expect(withTwin.find((i) => i.name === "Spotify")!.twins).toEqual([twin]);
  });

  const applesOf = (rows: Recurring[]) => calendar([month("2026-10", rows.map((s) => bill({ date: "2026-10-20", payee: s.merchant, cents: s.typicalAmountCents, seriesId: s.id })))]);
  it("with several from one merchant each row says its price in its name", () => {
    const out = cardOf([storage, music], [], applesOf([storage, music]));
    expect(out).toContain("Apple 7,99");
    expect(out).toContain("Apple 12,99");
    // after a rise the id keeps the product's old median: the name says the price charged now
    const raised = { ...music, typicalAmountCents: 1499, lastAmountCents: 1499 };
    const risen = cardOf([storage, raised], [], applesOf([storage, raised]));
    expect(risen).toContain("Apple 14,99");
    expect(risen).not.toContain("Apple 12,99");
  });

  const power = sub({ id: "out:acc-1:Sähköyhtiö", merchant: "Sähköyhtiö", category: "utilities", kind: "bill", typicalAmountCents: 6420 });
  it("says on each row whether it is known, an estimate, paid, or a card's to pay, and tags no kind", () => {
    const cal = calendar([
      month("2026-10", [
        bill({ date: "2026-10-12", payee: "Vesiyhtiö", state: "known" }),
        bill({ date: "2026-10-14", payee: "Sähköyhtiö", state: "estimate", seriesId: power.id }),
        bill({ date: "2026-10-03", payee: "Spotify", state: "paid", seriesId: spotify.id }),
        bill({ date: "2026-10-16", payee: "Kaasuyhtiö", onCard: true }),
      ]),
    ]);
    const out = cardOf([power, spotify], [], cal);
    for (const word of ["Tiedossa", "Arvio", "Maksettu", "Kortilla"]) expect(out).toContain(`>${word}<`);
    expect(out).not.toContain("mb-tag");
  });

  const MONTHLY = { monthly: true } as const;
  it("lists every row of this month and the next, and closes the months after them", () => {
    const monthly = (day: string, payee: string, cents: number) => bill({ date: day, payee, cents, ...MONTHLY });
    const cal = calendar([
      month("2026-10", [monthly("2026-10-12", "Vesiyhtiö", 2000)]),
      month("2026-11", [monthly("2026-11-12", "Vesiyhtiö", 2000)]),
      month("2026-12", [monthly("2026-12-12", "Vesiyhtiö", 2000), monthly("2026-12-15", "Kaasuyhtiö", 3000), bill({ date: "2026-12-20", payee: "Vakuutus", cents: 40000 })], { monthlyBillsCount: 2, monthlyBillsCents: 5000 }),
    ]);
    const out = cardOf([], [], cal);
    expect(out.match(/Tiedot: Vesiyhtiö/g)).toHaveLength(2);
    // the months after the next are closed, their head still says what they hold
    expect(out).not.toContain("Kaasuyhtiö");
    expect(out).not.toContain("Vakuutus");
    expect(out).toContain("Joulukuu 2026");
  });

  it("heads a month with core's sums, and says the sum left after the bills is not known while a bill's sum is not", () => {
    const sums = { knownCents: 177000, estimateCents: 64000, billsCents: 241000, incomeCents: 590000 };
    const cal = calendar([month("2026-10", [bill()], { ...sums, afterCents: 349000 }), month("2026-11", [bill()], { ...sums, afterCents: null })], { unknownCount: 1 });
    const out = cardOf([], [], cal);
    expect(out).toContain("Laskut 2 410,00 € (arviota 640,00 €)");
    expect(out).toContain("Tulot 5 900,00 €");
    expect(out).toContain("Laskujen jälkeen 3 490,00 €");
    expect(out).toContain("Laskujen jälkeen: ei tiedossa");
    expect(out).not.toContain("Erotus");
  });

  it("a bill that did not come stays a live row until the payments say it ended", () => {
    // due 5.9., not paid: on 11.10. it is 36 days late, past `active`, short of contract.ts's end (46 days)
    const contract = { startDate: "2025-09-05", firstPaymentCents: null, lastDate: "2026-08-05", ended: false, endedOn: null, monthlyCents: 6420, totalPaidCents: 77040, refund: null, costAfterRefundCents: 77040 };
    const power = sub({ id: "out:acc-1:Sähköyhtiö", merchant: "Sähköyhtiö", category: "utilities", kind: "bill", lastDate: "2026-08-05", nextDate: "2026-09-05", typicalAmountCents: 6420, active: false, overdue: false, contract });
    const items = billItems({ series: [power, spotify], typed: [], cancelled: new Set(), marks: marksBySubject([]), today: TODAY });
    expect(items.map((i) => [i.name, i.kind, i.ended, i.missed])).toEqual([
      ["Sähköyhtiö", "contract", false, "2026-09-05"],
      ["Spotify", "subscription", false, null],
    ]);
    expect(cardOf([power, spotify], [])).not.toContain("Päättyneet");
    // once the payments say it ended, it is an ended row with its last day
    const ended = cardOf([{ ...power, contract: { ...contract, ended: true, endedOn: "2026-09-05" } }], []);
    expect(ended).toContain("Päättyneet 1");
    // answered as ended in Tarkistettavat: an ended row with the mark and its undo
    const answered = billItems({ series: [power], typed: [], cancelled: cancelledSubjects({ ...NO_INPUTS, marks: [mark(seriesMarkSubject(power), "cancelled")] }), marks: marksBySubject([mark(seriesMarkSubject(power), "cancelled")]), today: TODAY });
    expect(answered.map((i) => [i.kind, i.ended, i.stopped, i.missed])).toEqual([["ended", true, true, null]]);
    // past `active` the fixed costs leave it out, so its row has no month's share; while active it keeps the share
    expect(items[0]!.monthlyCents).toBeNull();
    const late = billItems({ series: [{ ...power, typicalAmountCents: 19260, active: true, overdue: true, nextDate: "2026-10-03", lastDate: "2026-09-03" }], typed: [], cancelled: new Set(), marks: marksBySubject([]), today: TODAY });
    expect(late[0]!.monthlyCents).toBe(power.monthlyCents);
    // a bill typed in under its name once the charges stopped is a row of its own, as the server counts it
    const typedBill = { id: "t1", name: "Sähköyhtiö", amountCents: 6420, dueDate: "2026-10-20", nextDate: "2026-10-20", cadence: "once", category: "utilities", counted: true } as unknown as Parameters<typeof billItems>[0]["typed"][number];
    const both = billItems({ series: [power], typed: [typedBill], cancelled: new Set(), marks: marksBySubject([]), today: TODAY });
    expect(both.map((i) => [i.kind, i.missed, i.twins?.length ?? 0])).toEqual([
      ["contract", "2026-09-05", 0],
      ["typed", null, 0],
    ]);
    // so is one under a series still active but overdue, which the forecast no longer takes for the typed bill
    const overdue = billItems({ series: [{ ...power, active: true, overdue: true, nextDate: "2026-10-03", lastDate: "2026-09-03" }], typed: [typedBill], cancelled: new Set(), marks: marksBySubject([]), today: TODAY });
    expect(overdue.map((i) => [i.kind, i.missed, i.twins?.length ?? 0])).toEqual([
      ["contract", "2026-10-03", 0],
      ["typed", null, 0],
    ]);
    // while on time it carries the typed bill
    const onTime = billItems({ series: [{ ...power, active: true, overdue: false, nextDate: "2026-10-12", lastDate: "2026-09-12" }], typed: [typedBill], cancelled: new Set(), marks: marksBySubject([]), today: TODAY });
    expect(onTime.map((i) => [i.kind, i.twins?.length ?? 0])).toEqual([["contract", 1]]);
  });

  it("a subscription marked as cancelled is an ended row, and one that is not has none", () => {
    const marked = cardOf([spotify], [mark(seriesMarkSubject(spotify), "cancelled")]);
    expect(marked).toContain("Päättyneet 1");
    expect(cardOf([spotify], [])).not.toContain("Päättyneet");
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
