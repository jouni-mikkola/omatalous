/** Rahan lähteet ja käyttö (MoneyFlow): the two columns stand at one height whatever their bands, and the hero sentence names the credit and its monthly share. */
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import "@banking/core/late";
import { MoneyFlow } from "../src/charts/forms/MoneyFlow.tsx";
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

  it("says the credit and its share of a month in the hero", () => {
    const hero = t("rpt.mf_hero", { months: 10, credit: "6 000 €", perMonth: "600 €" });
    expect(hero).toBe("Jakson 10 kuukauden aikana menoja katettiin luotolla 6 000 €. Se on 600 € kuussa.");
  });
});
