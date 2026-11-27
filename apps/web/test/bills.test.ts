import { cancelledSubjects, countingMark, marksBySubject, NO_INPUTS, seriesMarkSubject, type UserMark } from "@banking/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BillsTable, MarkAction } from "../src/components/bills/BillsTable.tsx";
import { billItems } from "../src/components/bills/items.ts";
import type { Calendar } from "../src/components/bills/calendar-rows.ts";
import { money } from "../src/format.ts";
import type { Recurring } from "../src/types.ts";
import { bill, calendar, lateBill, month } from "./bill-calendar-fixture.ts";

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

  it("keeps a bill that did not come as a row marked Ei tullut in the month of today, once", () => {
    const { today, series, power: late, calendar: cal } = lateBill();
    const items = billItems({ series, typed: [], cancelled: new Set(), marks: marksBySubject([]), today });
    const out = flat(renderToStaticMarkup(createElement(BillsTable, { calendar: cal, items, controls: controlsOf([]), label, scope: "own", onRemoved: () => {} })));
    expect(late.overdue).toBe(true);
    expect(out.split("Ei tullut").length - 1, "rows marked Ei tullut").toBe(1);
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
  it("says on a row that its sum is an estimate, that it is paid or a card's to pay, nothing on a known one, and tags no kind", () => {
    const cal = calendar([
      month("2026-10", [
        bill({ date: "2026-10-12", payee: "Vesiyhtiö", state: "known" }),
        bill({ date: "2026-10-14", payee: "Sähköyhtiö", state: "estimate", seriesId: power.id }),
        bill({ date: "2026-10-03", payee: "Spotify", state: "paid", seriesId: spotify.id }),
        bill({ date: "2026-10-16", payee: "Kaasuyhtiö", onCard: true }),
      ]),
    ]);
    const out = cardOf([power, spotify], [], cal);
    for (const word of ["Summa arvioitu", "Arvio", "Maksettu", "Kortilla"]) expect(out).toContain(`>${word}<`);
    expect(out.match(/class="bill-flag"/g)).toHaveLength(3);
    expect(out).not.toContain("Tiedossa");
    expect(out).not.toContain("mb-tag");
  });

  const MONTHLY = { monthly: true } as const;
  const monthly = (day: string, payee: string, cents: number, over: Parameters<typeof bill>[0] = {}) => bill({ date: day, payee, cents, ...MONTHLY, ...over });
  it("opens the running month alone while a bill of it is unpaid, and closes the months after it", () => {
    const cal = calendar([
      month("2026-10", [monthly("2026-10-12", "Vesiyhtiö", 2000)]),
      month("2026-11", [monthly("2026-11-12", "Vesiyhtiö", 2000)]),
      month("2026-12", [monthly("2026-12-12", "Vesiyhtiö", 2000), monthly("2026-12-15", "Kaasuyhtiö", 3000), bill({ date: "2026-12-20", payee: "Vakuutus", cents: 40000 })], { monthlyBillsCount: 2, monthlyBillsCents: 5000 }),
    ]);
    const out = cardOf([], [], cal);
    expect(out.match(/aria-expanded="true"/g)).toHaveLength(1);
    expect(out.match(/Tiedot: Vesiyhtiö/g)).toHaveLength(1);
    // the months after it are closed, their head still says what they hold
    expect(out).not.toContain("Kaasuyhtiö");
    expect(out).not.toContain("Vakuutus");
    expect(out).toContain("Marraskuu 2026");
    expect(out).toContain("Joulukuu 2026");
  });

  it("opens the next month alone when every bill of the running month is paid, and lists every row of it", () => {
    const cal = calendar([
      month("2026-10", [monthly("2026-10-03", "Vesiyhtiö", 2000, { state: "paid" })], { paidCents: 2000 }),
      month("2026-11", [monthly("2026-11-12", "Vesiyhtiö", 2000), monthly("2026-11-15", "Kaasuyhtiö", 3000)], { monthlyBillsCount: 2, monthlyBillsCents: 5000 }),
      month("2026-12", [monthly("2026-12-12", "Vesiyhtiö", 2000)]),
    ]);
    const out = cardOf([], [], cal);
    expect(out.match(/aria-expanded="true"/g)).toHaveLength(1);
    // the next month's rows, each its own: no fold of the monthly ones
    expect(out.match(/Tiedot: Vesiyhtiö/g)).toHaveLength(1);
    expect(out).toContain("Tiedot: Kaasuyhtiö");
    expect(out).not.toContain("Kuukausittaiset laskut");
    expect(out).not.toContain(">Maksettu<");
  });

  it("heads a closed month with one figure, its bills still to pay, and the open month with none: its rows end in every figure", () => {
    const sums = { knownCents: 177000, billsCents: 177000, incomeCents: 590000 };
    const cal = calendar([month("2026-10", [bill()], { ...sums, afterCents: 413000 }), month("2026-11", [bill()], { ...sums, afterCents: 413000 }), month("2026-12", [bill()], { ...sums, afterCents: null })]);
    const out = cardOf([], [], cal);
    const heads = [...out.matchAll(/<span class="bill-sums">(.*?)<\/span>/g)].map((m) => m[1]);
    expect(heads).toEqual(["Maksamatta 1 770,00 €", "Maksamatta 1 770,00 €"]);
    // the pays and the sum left are rows of the open month alone
    expect(out.match(/bill-total-income[^>]*>5 900,00 €/g)).toHaveLength(1);
    expect(out.match(/bill-total-after[^>]*>4 130,00 €/g)).toHaveLength(1);
    expect(out.match(/Laskujen jälkeen/g)).toHaveLength(1);
  });

  it("ends an open month with core's sums, and says the sum left after the bills is not known while a bill's sum is not", () => {
    const sums = { knownCents: 177000, estimateCents: 64000, billsCents: 241000, incomeCents: 590000 };
    const known = cardOf([], [], calendar([month("2026-10", [bill()], { ...sums, afterCents: 349000 }), month("2026-11", [bill()], { ...sums, afterCents: null })]));
    // a closed month's head tells what is to come; the open month's rows end in it
    expect(known).toContain("Maksamatta 2 410,00 €");
    expect(known).toMatch(/bill-total-coming[^>]*>2 410,00 €/);
    expect(known).toMatch(/bill-total-income[^>]*>5 900,00 €/);
    expect(known).toMatch(/bill-total-after[^>]*>3 490,00 €/);
    expect(known).not.toContain("Ei tiedossa");
    expect(known).not.toContain("Erotus");
    const unknown = cardOf([], [], calendar([month("2026-10", [bill()], { ...sums, afterCents: null })], { unknownCount: 1, unknowns: [{ days: ["2026-10-15"], open: false, kind: "bill", onCard: false }] }));
    expect(unknown).toMatch(/bill-total-after[^>]*>Ei tiedossa/);
    expect(unknown).toMatch(/bill-total-note[^>]*>1 laskun summa tai päivä ei ole tiedossa/);
  });

  it("shows the sum left after the bills in a month with no pay, below 0, and no line of pays", () => {
    const cal = calendar([month("2026-10", [bill()], { knownCents: 241000, billsCents: 241000, incomeCents: 0, afterCents: -241000 })]);
    const out = cardOf([], [], cal);
    expect(out).toMatch(new RegExp(`bill-total-after[^>]*>${flat(money(-241000))}`));
    expect(out).toMatch(/bill-total-name[^>]*>Laskujen jälkeen/);
    expect(out).not.toContain("Tulot");
    expect(out).not.toContain("Ei tiedossa");
  });

  it("heads the running month with its paid bills and what is still to come, never Laskut 0 over paid bills, and leaves out the sum after the bills when nothing is left to come", () => {
    const paid = bill({ date: "2026-10-03", cents: 154204, state: "paid" });
    const cal = calendar([month("2026-10", [paid], { paidCents: 154204 }), month("2026-11", [bill()], { knownCents: 6420, billsCents: 6420, incomeCents: 0, afterCents: -6420 })]);
    const out = cardOf([], [], cal);
    expect(out).toContain(`Maksamatta ${flat(money(0))}`);
    expect(out).not.toContain(`Laskut ${flat(money(0))}`);
    // the open month tells what is to come in the total that ends its rows
    expect(out).toContain(flat(money(6420)));
    expect(out).toMatch(new RegExp(`bill-total-after[^>]*>${flat(money(-6420))}`));
    expect(out.match(/Laskujen jälkeen/g)).toHaveLength(1);
  });

  it("ends an open month's rows with a total of what is to come, and of what is paid when a charge is made", () => {
    const cal = calendar([month("2026-10", [bill()], { paidCents: 5000, knownCents: 1000, estimateCents: 2000, billsCents: 3000, incomeCents: 10000, afterCents: 7000 })]);
    const out = cardOf([], [], cal);
    // the name and its figure together: the row's own amount (the fixture's default bill) is none of the totals
    expect(out).toMatch(new RegExp(`bill-total-paid[^>]*>${flat(money(5000))}`));
    expect(out).toMatch(new RegExp(`bill-total-coming[^>]*>${flat(money(3000))}`));
    expect(out).toMatch(/bill-total-name[^>]*>Maksettu/);
    expect(out).toMatch(/bill-total-name[^>]*>Maksamatta/);
  });

  it("ends an open month with Maksettu, Maksamatta and its parts by kind, Säästöön, Tulot and Laskujen jälkeen, in that order", () => {
    const sums = { paidCents: 5000, knownCents: 1000, billsCents: 1000, savingCents: 15000, incomeCents: 10000, afterCents: -6000 };
    const names = (html: string) => [...html.matchAll(/class="bill-total-name">([^<]*)</g)].map((m) => m[1]);
    expect(names(cardOf([], [], calendar([month("2026-10", [bill()], { ...sums, essentialCents: 600, optionalCents: 400 })])))).toEqual(["Maksettu", "Maksamatta", "Asuminen ja välttämättömät", "Valinnaiset", "Säästöön", "Tulot", "Laskujen jälkeen"]);
    // one kind alone is the sum itself and is no row
    expect(names(cardOf([], [], calendar([month("2026-10", [bill()], { ...sums, essentialCents: 1000 })])))).toEqual(["Maksettu", "Maksamatta", "Säästöön", "Tulot", "Laskujen jälkeen"]);
  });

  it("keeps the table caption out of sight, so the card's heading is the only one drawn", () => {
    const html = cardOf([], [], calendar([month("2026-10", [bill()])]));
    expect(html).toMatch(/<caption class="sr-only">Laskut, sopimukset ja tilaukset<\/caption>/);
    expect(html.match(/<h2>Laskut, sopimukset ja tilaukset<\/h2>/g)).toHaveLength(1);
  });

  it("marks the open month a bill with no day may fall in with the count of the bills whose sum or day is not known, and with nothing when none is", () => {
    const months = [month("2026-10", [bill()], { billsCents: 241000, afterCents: null }), month("2026-11", [bill()], { billsCents: 241000, afterCents: null })];
    const noDay = { days: [], open: false, kind: "bill" as const, onCard: false };
    const marked = cardOf([], [], calendar(months, { unknownCount: 2, unknowns: [noDay, noDay] }));
    // the count stands on the row of the sum left, which only the open month has: a closed month's head keeps its one figure
    expect(marked.match(/bill-total-note[^>]*>2 laskun summa tai päivä ei ole tiedossa/g)).toHaveLength(1);
    expect(cardOf([], [], calendar(months.map((m) => ({ ...m, afterCents: 0 })))).includes("ei ole tiedossa")).toBe(false);
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
