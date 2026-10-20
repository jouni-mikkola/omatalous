import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type DaySum, type ListedRow, ownerLink, TxCards, TxItem, TxRow, TxTable } from "../src/pages/TransactionRows.tsx";

const row = (over: Partial<ListedRow> = {}): ListedRow =>
  ({ id: "t1", accountId: "a/1", bookingDate: "2026-10-05", merchant: "ESIMERKKI OY", amountCents: 80_000, own: false, status: "booked", category: "other", ...over }) as ListedRow;
const props = { categories: [], pending: null, onCategory: () => {}, account: "Yhteistili" };
const phone = (t: ListedRow) => renderToStaticMarkup(createElement(TxItem, { t, ...props }));
const wide = (t: ListedRow) => renderToStaticMarkup(createElement("table", null, createElement("tbody", null, createElement(TxRow, { t, ...props }))));

describe("the link of a row whose payer is not told", () => {
  it("leads to the account's parts on Tilit for a row with an open sum", () => {
    expect(ownerLink(row({ openCents: 55_219 }))).toBe("#/settings#tili-a/1");
    expect(phone(row({ openCents: 55_219 }))).toContain('<a class="tx-part" href="#/settings#tili-a/1">Kenen?</a>');
    expect(wide(row({ openCents: 55_219 }))).toContain('<a class="tx-part" href="#/settings#tili-a/1">Kenen?</a>');
  });

  it("is not there for a row with nothing open, or with the field left out", () => {
    for (const t of [row(), row({ openCents: 0 })]) {
      expect(ownerLink(t)).toBeNull();
      expect(phone(t)).not.toContain("Kenen?");
      expect(wide(t)).not.toContain("Kenen?");
    }
  });
});

// the figures of a piece of markup in the order they stand, in cents ("−36,24 €" is -3624)
const figures = (html: string, cls: string): number[] =>
  [...html.matchAll(new RegExp(`class="${cls}[^"]*">(?:<button[^>]*>)?([^<]*)`, "g"))].map((m) => Math.round(Number(m[1]!.replace(/[^\d,+−-]/g, "").replace("−", "-").replace(",", ".")) * 100));

describe("the part of a joint account's row", () => {
  it("is the row's figure, a button that opens it, with the bank's amount under it", () => {
    for (const show of [phone, wide]) {
      const html = show(row({ amountCents: -60_000, partCents: -30_000 }));
      expect(figures(html, "tx-amount")).toEqual([-30_000]);
      expect(html).toMatch(/class="tx-amount[^"]*"><button[^>]*why-door/);
      expect(html).toContain('<span class="tx-part">koko summa −600,00');
    }
  });

  it("near misses: a part equal to the amount is the whole row, a row the server gives no part shows the bank's amount, a part of nothing is 0 and opens nothing", () => {
    for (const show of [phone, wide]) {
      for (const t of [row({ amountCents: 20_000, partCents: 20_000 }), row({ amountCents: 20_000 })]) {
        expect(figures(show(t), "tx-amount")).toEqual([20_000]);
        expect(show(t)).not.toContain("koko summa");
      }
      const none = show(row({ amountCents: 20_000, partCents: 0 }));
      expect(figures(none, "tx-amount")).toEqual([0]);
      expect(none).not.toContain("why-door");
      expect(none).toContain("koko summa +200,00");
    }
  });

  it("makes a day's rows add up to the day's sum the server gives, with a joint row among them", () => {
    // Pe 18.9 of the report: the joint row's bank amount is −36,24 €, the viewer's part −21,74 €, the head −167,73 €
    const items = [row({ id: "j", bookingDate: "2026-09-18", amountCents: -3_624, partCents: -2_174 }), row({ id: "o", accountId: "a/2", bookingDate: "2026-09-18", amountCents: -14_599 })];
    const daySums = new Map<string, DaySum>([["2026-09-18", { date: "2026-09-18", count: 2, inCents: 0, outCents: 16_773 }]]);
    const rowProps = (t: ListedRow) => ({ t, ...props });
    const lists = [
      renderToStaticMarkup(createElement(TxCards, { items, today: "2026-10-05", daySums, rowProps, scope: "own" })),
      renderToStaticMarkup(createElement(TxTable, { items, today: "2026-10-05", density: "comfortable", daySums, rowProps, scope: "own" })),
    ];
    for (const html of lists) {
      expect(figures(html, "rt-sub")).toEqual([-16_773]);
      expect(figures(html, "tx-amount").reduce((a, b) => a + b, 0)).toBe(-16_773);
    }
  });
});
