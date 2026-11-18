/**
 * The buffer line of Yhteenveto's Varat ja velat: core's months with a comma, the two sums behind them in a drill, and
 * the reason core gives while there is no figure.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Buffer } from "../src/components/home/Buffer.tsx";
import type { DashboardData } from "../src/types.ts";

type Direction = DashboardData["home"]["direction"];

const direction = (over: Partial<Direction>): Direction => ({ usualCents: 300_000, months: 6, bufferMonths: null, bufferNetCents: null, bufferSpendCents: null, bufferGap: null, ...over });

const flat = (s: string | null | undefined) => (s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();

describe("Buffer", () => {
  it("says the months with a decimal comma and opens to the two sums core divides", () => {
    const net = 420_000;
    const spend = 300_000;
    const { container } = render(createElement(Buffer, { direction: direction({ bufferMonths: net / spend, bufferNetCents: net, bufferSpendCents: spend }) }));
    const summary = screen.getByText("Puskuri 1,4 kk");
    expect(summary.tagName).toBe("SUMMARY");
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    fireEvent.click(summary);
    const terms = [...container.querySelectorAll(".st-row")].map((row) => [...row.children].map((c) => flat(c.textContent)));
    expect(terms).toEqual([
      ["Raha laskujen ja korttivelan jälkeen", "4 200,00 €"],
      ["Menot ja lainanmaksut kuukaudessa", "3 000,00 €"],
    ]);
  });

  it("shows a negative buffer and its two sums as they are", () => {
    const net = -150_000;
    const spend = 300_000;
    const { container } = render(createElement(Buffer, { direction: direction({ bufferMonths: net / spend, bufferNetCents: net, bufferSpendCents: spend }) }));
    const summary = screen.getByText("Puskuri −0,5 kk");
    fireEvent.click(summary);
    const terms = [...container.querySelectorAll(".st-row")].map((row) => [...row.children].map((c) => flat(c.textContent)));
    expect(terms).toEqual([
      ["Raha laskujen ja korttivelan jälkeen", "−1 500,00 €"],
      ["Menot ja lainanmaksut kuukaudessa", "3 000,00 €"],
    ]);
  });

  it("says Ei menoja when core's reason is that the expected month has no spending", () => {
    const { container } = render(createElement(Buffer, { direction: direction({ bufferGap: "no-spending" }) }));
    expect(flat(container.textContent)).toBe("Puskuri Ei menoja");
    expect(container.querySelector("details")).toBeNull();
  });

  it("says Ei saldoa when core's reason is no balance", () => {
    const { container } = render(createElement(Buffer, { direction: direction({ bufferGap: "no-balance" }) }));
    expect(flat(container.textContent)).toBe("Puskuri Ei saldoa");
    expect(container.querySelector("details")).toBeNull();
  });

  it("says Liian lyhyt historia when core's reason is a short history", () => {
    const { container } = render(createElement(Buffer, { direction: direction({ bufferGap: "history" }) }));
    expect(flat(container.textContent)).toBe("Puskuri Liian lyhyt historia");
  });

  it("shows nothing when core gives neither a figure nor a reason", () => {
    const { container } = render(createElement(Buffer, { direction: direction({}) }));
    expect(container.textContent).toBe("");
  });
});
