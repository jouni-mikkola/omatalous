/**
 * The points an add-on module draws into (docs/MODULES.md): its mark and part on a row of Tapahtumat, the parts the
 * server tells under a category on Raportit > Menot, and its page in the user menu. The module here is made up in the
 * test; with none registered, the same views have no element of it.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { WEB_EXTENSIONS, extensionPages } from "../src/extensions.ts";
import { type ListedRow, TxTable } from "../src/pages/TransactionRows.tsx";
import { section } from "../src/pages/reports/sections/CategoryParts.tsx";
import { page as spending } from "../src/pages/reports/pages/Spending.tsx";
import type { ReportContext } from "../src/pages/reports/types.ts";
import type { TransactionItem } from "../src/types.ts";

/** What the made-up module's server half adds to a row through `rowFields`. */
type Told = TransactionItem & { exampleNote?: string };

const testModule = {
  id: "example",
  rowMark: ({ row }: { row: TransactionItem }) => ((row as Told).exampleNote ? createElement("span", { className: "example-mark" }, "E") : null),
  rowPart: ({ row }: { row: TransactionItem }) => ((row as Told).exampleNote ? createElement("p", { className: "example-part" }, (row as Told).exampleNote) : null),
  page: { label: "Esimerkki", component: () => null },
};

afterEach(() => {
  WEB_EXTENSIONS.splice(0);
});

const row = (over: Partial<Told> = {}): ListedRow =>
  ({ id: "t1", accountId: "a/1", bookingDate: "2026-10-05", merchant: "ESIMERKKI OY", amountCents: -4_000, own: true, status: "booked", category: "groceries", ...over }) as ListedRow;
const props = { categories: [], pending: null, onCategory: () => {}, account: "Käyttötili" };
const list = (t: ListedRow, open = false) =>
  renderToStaticMarkup(
    createElement(TxTable, {
      items: [t], severalAccounts: true, today: "2026-10-05", daySums: new Map(), rowProps: (r: ListedRow) => ({ t: r, ...props, onStatement: () => {} }), scope: "own",
      open: open ? t.id : null, onOpen: () => {}, view: { query: "", chip: null, group: null, sort: null }, onView: () => {}, filters: null, searchLabel: "Hae",
    }),
  );

describe("a row of Tapahtumat with an add-on module", () => {
  it("wears the module's mark on its line and shows the module's part when opened, from the fields the server added", () => {
    WEB_EXTENSIONS.push(testModule);
    const told = row({ exampleNote: "Kaksi osaa" });
    const closed = list(told);
    // the mark stands on the row's line beside the tags, so the row stays one line high
    expect(closed).toMatch(/<span class="tx-line">.*<span class="example-mark">E<\/span><\/span>/);
    expect(closed).not.toContain("example-part");
    expect(list(told, true)).toContain('<p class="example-part">Kaksi osaa</p>');
    // a row the server added nothing to has neither
    expect(list(row(), true)).not.toMatch(/example-(mark|part)/);
  });

  it("is the same markup as before with no module", () => {
    const told = row({ exampleNote: "Kaksi osaa" });
    const without = [list(told), list(told, true)];
    expect(without.join("")).not.toMatch(/example-/);
    // a module that has neither point changes nothing either
    WEB_EXTENSIONS.push({ id: "example" });
    expect([list(told), list(told, true)]).toEqual(without);
  });
});

type Stat = { category: string; totalCents: number; parts?: { id: string; label: string; cents: number; estimated: boolean }[] };
const context = (stats: Stat[]): ReportContext =>
  ({
    data: { categories: { groups: [{ group: "living", categories: stats }] } },
    meta: { today: "2026-10-11", accounts: [] },
    range: { from: "2026-01-01", to: "2026-10-11" },
    scope: "own",
    label: (id: string) => ({ groceries: "Ruoka", restaurants: "Ravintolat" })[id] ?? id,
    exportHref: () => "",
  }) as unknown as ReportContext;
const html = (ctx: ReportContext) => renderToStaticMarkup(createElement(section.Component, { ctx })).replace(/[  ]/g, " ");

describe("the parts of a category on Raportit > Menot", () => {
  it("is a section of the spending page, with no card while no category has parts", () => {
    expect(spending.sections).toContain(section);
    expect(section.reports).toEqual(["categories"]);
    expect(section.visible!(context([{ category: "groceries", totalCents: 50_000 }, { category: "restaurants", totalCents: 9_000, parts: [] }]))).toBe(false);
    expect(section.visible!(context([]))).toBe(false);
  });

  it("lists each split category's parts under its name and figure, as the server gave them, a guessed one with ≈", () => {
    const ctx = context([
      { category: "groceries", totalCents: 50_000, parts: [{ id: "fresh", label: "Tuoreet", cents: 30_000, estimated: false }, { id: "unsplit", label: "Muut", cents: 20_000, estimated: true }] },
      { category: "restaurants", totalCents: 9_000 },
    ]);
    expect(section.visible!(ctx)).toBe(true);
    const out = html(ctx);
    expect(out).toContain("Ruoka");
    expect(out).toContain("500,00 €");
    expect(out).toContain("Tuoreet");
    expect(out).toContain("300,00 €");
    expect(out).toMatch(/Muut.*≈/);
    // a category with no parts is not in the table
    expect(out).not.toContain("Ravintolat");
    expect(out).toContain("#/transactions?category=groceries&amp;from=2026-01-01&amp;to=2026-10-11");
  });
});

describe("the page of an add-on module", () => {
  it("has its entry in the user menu only while a module with a page is registered", () => {
    expect(extensionPages()).toEqual([]);
    WEB_EXTENSIONS.push({ id: "other" }, testModule);
    expect(extensionPages().map((e) => [e.id, e.page!.label])).toEqual([["example", "Esimerkki"]]);
  });
});
