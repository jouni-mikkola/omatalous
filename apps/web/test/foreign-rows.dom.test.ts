/**
 * The rows in another currency under an account: a day of the running year is read without its year, an older one with it,
 * in the reader's language.
 */
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import "./fixed-clock.ts";
import { setLanguage } from "../src/format.ts";
import { ForeignRows, type ForeignCurrency } from "../src/pages/settings/ForeignRows.tsx";

const USD: ForeignCurrency = {
  currency: "USD",
  count: 2,
  totalMinor: -3000,
  scale: 2,
  rows: [
    { day: "2026-10-03", amountMinor: -1000, scale: 2, text: "Kahvila" },
    { day: "2025-10-03", amountMinor: -2000, scale: 2, text: "Hotelli" },
  ],
};

/** The day cell of every row, in the order drawn. */
function days(): (string | null | undefined)[] {
  const { container } = render(createElement(ForeignRows, { currencies: [USD] }));
  return [...container.querySelectorAll(".acc-foreign-rows li")].map((li) => li.firstElementChild?.textContent);
}

describe("ForeignRows", () => {
  afterEach(() => {
    cleanup();
    setLanguage("fi");
  });

  it("leaves the year out of a day of this year and keeps it on a day of last year", () => {
    setLanguage("fi");
    expect(days()).toEqual(["3.10.", "3.10.2025"]);
  });

  it("writes the days in the English form in English", () => {
    setLanguage("en");
    expect(days()).toEqual(["3/10", "3/10/2025"]);
  });
});
