/**
 * A span of marks on a chart (charts/kit/span.ts): the keys that move it, the mark under the pointer, and the two places
 * that take it: the table under a chart (rows between two keys) and the period of the list over Tapahtumat.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { indexAtX, spanBounds, spanKey } from "../src/charts/kit/span.ts";
import { ChartWithTable } from "../src/components/table/selection.tsx";
import { Table } from "../src/components/table/Table.tsx";
import { TotalsStrip } from "../src/pages/transactions/TotalsStrip.tsx";

afterEach(cleanup);

describe("the keys and the pointer of a span", () => {
  it("finds the mark under an x position and keeps the ends to the first and last mark", () => {
    expect(indexAtX(50, 0, 100, 4)).toBe(2);
    expect(indexAtX(-10, 0, 100, 4)).toBe(0);
    expect(indexAtX(500, 0, 100, 4)).toBe(3);
    expect(spanBounds({ anchor: 5, head: 2 })).toEqual([2, 5]);
  });
  it("moves the end of the span from the focused mark with Shift, and not without it", () => {
    expect(spanKey("ArrowRight", true, null, 3, 8)).toMatchObject({ span: { anchor: 3, head: 4 }, moved: 4 });
    expect(spanKey("ArrowLeft", true, { anchor: 3, head: 4 }, 4, 8)).toMatchObject({ span: { anchor: 3, head: 3 } });
    expect(spanKey("End", true, { anchor: 3, head: 4 }, 4, 8)).toMatchObject({ span: { anchor: 3, head: 7 } });
    expect(spanKey("ArrowRight", true, { anchor: 3, head: 7 }, 7, 8)).toMatchObject({ span: { anchor: 3, head: 7 } });
    expect(spanKey("ArrowRight", false, null, 3, 8)).toBeNull();
  });
  it("sends a span on with Enter and lets go with Escape, which needs a span or one held elsewhere", () => {
    const span = { anchor: 1, head: 3 };
    expect(spanKey("Enter", false, span, 3, 8)).toMatchObject({ commit: true });
    expect(spanKey("Enter", false, null, 3, 8)).toBeNull();
    expect(spanKey("Escape", false, span, 3, 8)).toMatchObject({ release: true, span: null });
    expect(spanKey("Escape", false, null, 3, 8)).toBeNull();
    expect(spanKey("Escape", false, null, 3, 8, true)).toMatchObject({ release: true });
  });
});

describe("a span in the table under a chart", () => {
  const rows = ["2026-01", "2026-02", "2026-03", "2026-04"].map((month) => ({ month }));
  it("keeps the rows between the two keys, names the first and last, and shows all again from the notice", () => {
    render(
      createElement(ChartWithTable, {
        chart: (pick) => createElement("button", { onClick: () => pick.selectRange("2026-02", "2026-03") }, "span"),
        table: createElement(Table<(typeof rows)[number]>, { caption: "Kuukaudet", rows, rowKey: (r) => r.month, columns: [{ key: "m", label: "Kuukausi", kind: "text", rowHead: true, cell: (r) => r.month }] }),
      }),
    );
    expect(document.querySelectorAll("tbody tr")).toHaveLength(4);
    fireEvent.click(screen.getByText("span"));
    expect([...document.querySelectorAll("tbody tr")].map((r) => r.textContent)).toEqual(["2026-02", "2026-03"]);
    expect(document.querySelector(".rt-filter")!.textContent).toContain("2026-02 – 2026-03");
    fireEvent.click(document.querySelector(".rt-filter button")!);
    expect(document.querySelectorAll("tbody tr")).toHaveLength(4);
  });
});

describe("a span of the histogram over Tapahtumat", () => {
  const totals = {
    total: 4,
    inCents: 0,
    outCents: 90_00,
    span: { from: "2026-09-01", to: "2026-09-04" },
    histogram: {
      unit: "day" as const,
      bins: ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"].map((start, i) => ({ start, count: 1, outCount: 1, inCount: 0, inCents: 0, outCents: (i + 1) * 10_00 })),
    },
  };
  it("limits the period to the span on Enter, and Escape returns to the period before while the pick is on show", () => {
    const onPick = vi.fn();
    const { rerender } = render(createElement(TotalsStrip, { totals, income: false, today: "2026-10-13", onPick }));
    const plot = screen.getByRole("img");
    fireEvent.focus(plot);
    // the focus starts on the highest bar, the fourth day; Shift and the left arrow take the span back a day each
    fireEvent.keyDown(plot, { key: "ArrowLeft", shiftKey: true });
    fireEvent.keyDown(plot, { key: "ArrowLeft", shiftKey: true });
    expect(document.querySelector(".tx-hist-readout")!.textContent).toContain("Valittu");
    fireEvent.keyDown(plot, { key: "Enter" });
    expect(onPick).toHaveBeenLastCalledWith({ from: "2026-09-02", to: "2026-09-04" });
    rerender(createElement(TotalsStrip, { totals: { ...totals, span: { from: "2026-09-02", to: "2026-09-04" } }, income: false, today: "2026-10-13", onPick }));
    fireEvent.keyDown(screen.getByRole("img"), { key: "Escape" });
    expect(onPick).toHaveBeenLastCalledWith({ from: "2026-09-01", to: "2026-09-04" });
  });
});
