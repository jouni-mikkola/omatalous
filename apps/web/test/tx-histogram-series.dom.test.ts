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

describe("the figures of the strip", () => {
  const terms = () => [...document.querySelectorAll(".tx-totals-kv > div")].map((d) => [d.querySelector("dt")!.textContent, d.querySelector("dd")!.textContent]);
  const strip = (extra: object) => render(createElement(TotalsStrip, { totals: { ...totals, ...extra }, income: false, today: "2026-10-13", onPick: () => {} }));

  it("names what was taken out of savings and shows its amount with no sign, then Tulos", () => {
    strip({ savedCents: -200_00, leftCents: 1030_00 });
    expect(terms().map(([word]) => word)).toEqual(["Menot", "Tulot", "Erotus", "Otettu säästöistä", "Käteen jäi"]);
    expect(terms()[3]![1]).toMatch(/^200\s€$/);
    expect(terms()[3]![1]).not.toMatch(/[-−+]/);
    expect(terms()[4]![1]).toMatch(/^\+1\s030\s€$/);
  });

  it("shows the amount moved to savings with no sign, and leaves Tulos out when it is the Erotus", () => {
    strip({ savedCents: 300_00, leftCents: 530_00 });
    expect(terms()[3]).toEqual(["Säästöön siirretty", expect.stringMatching(/^300\s€$/)]);
    cleanup();
    strip({ savedCents: 0, leftCents: 830_00 });
    expect(terms().map(([word]) => word)).toEqual(["Menot", "Tulot", "Erotus"]);
  });
});

describe("the histogram's direction switch", () => {
  it("starts on money out and names its highest bar", () => {
    render(createElement(TotalsStrip, { totals, income: false, today: "2026-10-13", onPick: () => {} }));
    expect(readout()).toContain("menot");
    expect(readout()).toContain("50,00");
    expect(screen.getByRole("button", { name: t("tx.spending") }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the highest bar of money in once Sisään is chosen, and back again", () => {
    render(createElement(TotalsStrip, { totals, income: false, today: "2026-10-13", onPick: () => {} }));
    fireEvent.click(screen.getByRole("button", { name: t("tx.income") }));
    expect(readout()).toContain("tulot");
    expect(readout()).toContain("900,00");
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("Tulot");
    fireEvent.click(screen.getByRole("button", { name: t("tx.spending") }));
    expect(readout()).toContain("menot");
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("Menot");
  });

  it("starts on money in when the list is limited to income", () => {
    render(createElement(TotalsStrip, { totals, income: true, today: "2026-10-13", onPick: () => {} }));
    expect(readout()).toContain("tulot");
  });
});
