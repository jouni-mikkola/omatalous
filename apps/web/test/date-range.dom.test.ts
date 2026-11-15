/** The calendar of the period picker is a real grid: rows of cells, one tab stop, arrow keys between days. */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DateRange } from "../src/pages/transactions/DateRange.tsx";

afterEach(cleanup);
const show = (onCommit = vi.fn()) => {
  render(createElement(DateRange, { value: { from: "", to: "" }, today: "2026-10-15", onCommit }));
  return { onCommit, grid: screen.getByRole("grid") };
};
/** A day by its date, not its label: the label's year follows the real clock. */
const day = (d: number) => {
  const found = document.querySelector<HTMLButtonElement>(`button[data-day="2026-10-${String(d).padStart(2, "0")}"]`);
  if (!found) throw new Error(`no day ${d}`);
  return found;
};

describe("DateRange calendar", () => {
  it("has the weekday names in a row of column headers and the days in rows of seven cells", () => {
    const { grid } = show();
    const rows = within(grid).getAllByRole("row");
    expect(within(rows[0]!).getAllByRole("columnheader")).toHaveLength(7);
    for (const r of rows.slice(1)) expect(within(r).getAllByRole("gridcell")).toHaveLength(7);
    expect(grid.querySelectorAll(":scope > :not([role=row])")).toHaveLength(0);
  });

  it("has one tab stop", () => {
    const { grid } = show();
    const days = [...grid.querySelectorAll<HTMLButtonElement>("button")];
    expect(days.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    expect(days.filter((b) => b.tabIndex === -1)).toHaveLength(days.length - 1);
    expect(day(15).tabIndex).toBe(0);
  });

  it("moves focus with the arrow keys, never past today", () => {
    show();
    day(15).focus();
    fireEvent.keyDown(day(15), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(day(14));
    fireEvent.keyDown(day(14), { key: "ArrowUp" });
    expect(document.activeElement).toBe(day(7));
    fireEvent.keyDown(day(7), { key: "ArrowDown" });
    expect(document.activeElement).toBe(day(14));
    fireEvent.keyDown(day(14), { key: "ArrowRight" });
    expect(document.activeElement).toBe(day(15));
    fireEvent.keyDown(day(15), { key: "ArrowRight" });
    expect(document.activeElement).toBe(day(15));
    fireEvent.keyDown(day(15), { key: "ArrowDown" });
    expect(document.activeElement).toBe(day(15));
  });

  it("commits two picked days", () => {
    const { onCommit } = show();
    fireEvent.click(day(3));
    fireEvent.click(day(9));
    fireEvent.click(screen.getByRole("button", { name: /Näytä/ }));
    expect(onCommit).toHaveBeenCalledWith({ from: "2026-10-03", to: "2026-10-09" });
  });
});
