/** Rahan lähteet ja käyttö (MoneyFlow): the two columns stand at one height whatever their bands, and the hero sentence names the credit and its monthly share. */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import "@banking/core/late";
import { MoneyFlow, MoneyFlowMonths } from "../src/charts/forms/MoneyFlow.tsx";
import { t } from "../src/text.ts";

afterEach(cleanup);

const sources = [
  { id: "earned", label: "Palkka", kind: "income", cents: 300_000 },
  { id: "credit", label: "Luotosta", kind: "drawn", cents: 1_000 },
] as const;
const uses = [
  { id: "category:housing", label: "Asuminen", kind: "spending", cents: 200_000 },
  { id: "stayed", label: "Jäi tileille", kind: "kept", cents: 101_000 },
] as const;

describe("Rahan lähteet ja käyttö", () => {
  it("draws both sides as columns of one height, a thin band kept visible", () => {
    const { container } = render(createElement(MoneyFlow, { sources, uses }));
    const columns = [...container.querySelectorAll("svg.mf-column")];
    expect(columns).toHaveLength(2);
    const ends = columns.map((svg) => Math.max(...[...svg.querySelectorAll("rect")].map((r) => Number(r.getAttribute("y")) + Number(r.getAttribute("height")))));
    expect(ends[0]).toBeCloseTo(320, 5);
    expect(ends[1]).toBeCloseTo(320, 5);
    const thin = [...columns[0]!.querySelectorAll("rect")].map((r) => Number(r.getAttribute("height")));
    expect(Math.min(...thin)).toBeGreaterThanOrEqual(4);
  });

  it("picks a month with a press and returns to the period with the same press", () => {
    const picks: (string | null)[] = [];
    const { container, rerender } = render(createElement(MoneyFlowMonths, { months: ["2026-02", "2026-03"], picked: null, onPick: (m) => picks.push(m) }));
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false"]);
    fireEvent.click(buttons[1]!);
    rerender(createElement(MoneyFlowMonths, { months: ["2026-02", "2026-03"], picked: "2026-03", onPick: (m) => picks.push(m) }));
    fireEvent.click(container.querySelectorAll("button")[1]!);
    expect(picks).toEqual(["2026-03", null]);
  });

  it("links the bands the address names and no others", () => {
    const { container } = render(createElement(MoneyFlow, { sources, uses, href: (b) => (b.id === "earned" ? "#/transactions?kind=income" : null) }));
    expect([...container.querySelectorAll(".mf-legend a")].map((a) => a.getAttribute("href"))).toEqual(["#/transactions?kind=income"]);
  });

  it("says the credit and its share of a month in the hero", () => {
    const hero = t("rpt.mf_hero", { months: 10, credit: "6 000 €", perMonth: "600 €" });
    expect(hero).toBe("Jakson 10 kuukauden aikana menoja katettiin luotolla 6 000 €. Se on 600 € kuussa.");
  });
});
