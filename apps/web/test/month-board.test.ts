/** Laskut's month board: the fixed costs of a month are today's, so only the running month shows them. */
import type { BillBoard } from "@banking/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MonthBoard } from "../src/components/bills/MonthBoard.tsx";

const TODAY = "2026-10-19";
const board = (month: string): BillBoard => ({
  month,
  from: `${month}-01`,
  to: `${month}-28`,
  rows: [],
  totals: { paidCents: 0, comingCents: 0, missingCents: 0, dueCents: 0 },
  fixedMonthlyCents: 227_014,
  earliest: "2025-10",
  latest: "2026-11",
});
const render = (month: string) =>
  renderToStaticMarkup(createElement(MonthBoard, { board: board(month), loading: false, onMonth: () => {}, today: TODAY, scope: "own", fixedEstimate: true, fixedRange: { from: "2025-10-19", to: TODAY } }));

describe("Kiinteät menot kuussa on Laskut", () => {
  it("stands on the running month", () => {
    expect(render("2026-10")).toContain("Kiinteät menot kuussa");
  });

  it("is not on a past month or the next one, which today's figure does not describe", () => {
    for (const month of ["2026-09", "2026-03", "2026-11"]) expect(render(month)).not.toContain("Kiinteät menot kuussa");
  });
});
