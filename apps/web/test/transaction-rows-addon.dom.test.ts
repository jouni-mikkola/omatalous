/**
 * An add-on module's part on a row of Tapahtumat that throws as it renders is dropped: the rows stay, the shell's notice
 * of a failed add-on is set, and a part that works is still drawn.
 */
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addOnLoadFailed, markAddOnFailed, WEB_EXTENSIONS } from "../src/extensions.ts";
import { type ListedRow, TxTable } from "../src/pages/TransactionRows.tsx";

const row = { id: "t1", accountId: "a/1", bookingDate: "2026-10-05", merchant: "ESIMERKKI OY", amountCents: 80_000, own: false, status: "booked", category: "other" } as ListedRow;
const props = { categories: [], pending: null, onCategory: () => {}, account: "Yhteistili" };
const table = (open: string | null) =>
  createElement(TxTable, { items: [row], today: "2026-10-05", daySums: new Map(), rowProps: (r: ListedRow) => ({ t: r, ...props, onStatement: () => {} }), scope: "own", open, onOpen: () => {}, view: { query: "", chip: null, group: null, sort: null }, onView: () => {} });
const Broken = () => {
  throw new TypeError("approxText is not a function");
};
const Working = () => createElement("span", null, "lisäosan merkki");

afterEach(() => {
  WEB_EXTENSIONS.splice(0);
  markAddOnFailed(false);
  vi.restoreAllMocks();
});

describe("a failing add-on part on a row", () => {
  it("drops a rowMark that throws and still draws the row and the other add-on's mark", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    WEB_EXTENSIONS.push({ id: "broken", rowMark: Broken }, { id: "working", rowMark: Working });
    render(table(null));
    expect(screen.getAllByText("ESIMERKKI OY").length).toBeGreaterThan(0);
    expect(screen.getByText("lisäosan merkki")).toBeTruthy();
    expect(addOnLoadFailed()).toBe(true);
  });

  it("drops a rowPart that throws from the opened row", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    WEB_EXTENSIONS.push({ id: "broken", rowPart: Broken });
    render(table("t1"));
    expect(screen.getAllByText("ESIMERKKI OY").length).toBeGreaterThan(0);
    expect(addOnLoadFailed()).toBe(true);
  });
});
