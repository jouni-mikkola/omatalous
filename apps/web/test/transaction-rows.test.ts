import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type ListedRow, ownerLink, TxItem, TxRow } from "../src/pages/TransactionRows.tsx";

const row = (over: Partial<ListedRow> = {}): ListedRow =>
  ({ id: "t1", accountId: "a/1", bookingDate: "2026-10-05", merchant: "ESIMERKKI OY", amountCents: 80_000, own: false, status: "booked", category: "other", ...over }) as ListedRow;
const props = { categories: [], categoryLabel: "Muu", pending: null, onCategory: () => {} };
const phone = (t: ListedRow) => renderToStaticMarkup(createElement(TxItem, { t, ...props }));
const wide = (t: ListedRow) => renderToStaticMarkup(createElement("table", null, createElement("tbody", null, createElement(TxRow, { t, account: "Yhteistili", ...props }))));

describe("the link of a row whose payer is not told", () => {
  it("leads to the account's parts on Tilit for a row with an open sum", () => {
    expect(ownerLink(row({ openCents: 55_219 }))).toBe("#/settings#tili-a/1");
    expect(phone(row({ openCents: 55_219 }))).toContain('<a class="tx-part" href="#/settings#tili-a/1">Kenen?</a>');
    expect(wide(row({ openCents: 55_219 }))).toContain('<a href="#/settings#tili-a/1">Kenen?</a>');
  });

  it("is not there for a row with nothing open, or with the field left out", () => {
    for (const t of [row(), row({ openCents: 0 })]) {
      expect(ownerLink(t)).toBeNull();
      expect(phone(t)).not.toContain("Kenen?");
      expect(wide(t)).not.toContain("Kenen?");
    }
  });
});
