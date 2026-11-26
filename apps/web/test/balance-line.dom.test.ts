/** Saldo päivittäin on Varat ja velat (BalanceLine): the axis names its first day when that day is not a 1st. */
import { cleanup, render } from "@testing-library/react";
import type { BalanceReport } from "@banking/core";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import "@banking/core/late";
import { BalanceLine } from "../src/charts/forms/BalanceLine.tsx";
import "./fixed-clock.ts";

afterEach(cleanup);

const labels = (from: string) => {
  const cents = Array.from({ length: 40 }, (_, i) => 100_000 + i * 1_000);
  const r = { daily: { from, cents }, lowest: null } as unknown as BalanceReport;
  const { container } = render(createElement(BalanceLine, { r }));
  return [...container.querySelectorAll("svg text")].map((t) => t.textContent);
};

describe("Saldo päivittäin", () => {
  it("names the first day on the axis when the range starts in the middle of a month", () => {
    expect(labels("2026-10-15")).toContain("15.10.");
  });

  it("names no first day when the range starts on a 1st, as the month's own name stands there", () => {
    expect(labels("2026-11-01")).not.toContain("1.11.");
  });
});
