/**
 * The histogram over Tapahtumat draws money out or money in as the reader chooses: the switch changes its title and the
 * line under it, which names the highest bar of the chosen direction.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { setLanguage } from "../src/format.ts";
import { TotalsStrip } from "../src/pages/transactions/TotalsStrip.tsx";
import { t } from "../src/text.ts";

afterEach(() => {
  cleanup();
  setLanguage("fi");
});

const totals = {
  total: 3,
  inCents: 900_00,
  outCents: 70_00,
  netCents: 830_00,
  span: { from: "2026-09-01", to: "2026-09-03" },
  histogram: {
    unit: "day" as const,
    bins: [
      { start: "2026-09-01", count: 1, inCents: 0, outCents: 20_00 },
      { start: "2026-09-02", count: 1, inCents: 900_00, outCents: 50_00 },
      { start: "2026-09-03", count: 1, inCents: 0, outCents: 0 },
    ],
  },
};

const readout = () => document.querySelector(".tx-hist-readout")!.textContent;

describe("the histogram's direction switch", () => {
  it("starts on money out and names its highest bar", () => {
    render(createElement(TotalsStrip, { totals, income: false, today: "2026-10-13", onPick: () => {} }));
    expect(readout()).toContain("rahaa ulos");
    expect(readout()).toContain("50,00");
    expect(screen.getByRole("button", { name: t("tx.spending") }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the highest bar of money in once Sisään is chosen, and back again", () => {
    render(createElement(TotalsStrip, { totals, income: false, today: "2026-10-13", onPick: () => {} }));
    fireEvent.click(screen.getByRole("button", { name: t("tx.income") }));
    expect(readout()).toContain("rahaa sisään");
    expect(readout()).toContain("900,00");
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("Rahaa sisään");
    fireEvent.click(screen.getByRole("button", { name: t("tx.spending") }));
    expect(readout()).toContain("rahaa ulos");
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("Rahaa ulos");
  });

  it("starts on money in when the list is limited to income", () => {
    render(createElement(TotalsStrip, { totals, income: true, today: "2026-10-13", onPick: () => {} }));
    expect(readout()).toContain("rahaa sisään");
  });
});
