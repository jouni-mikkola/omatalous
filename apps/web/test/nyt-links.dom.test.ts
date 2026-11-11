/** Nyt's figures open their basis: the bills sum, the spent sum and the balance are links; the lines read as before. */
import { render } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Nyt } from "../src/components/home/Nyt.tsx";
import type { DashboardData } from "../src/types.ts";

type NytData = NonNullable<DashboardData["nyt"]>;

const flat = (s: string | null | undefined) => (s ?? "").replace(/[\u00a0\u202f]/g, " ");

function data(known: boolean): DashboardData & { nyt: NytData } {
  const nyt: NytData = {
    from: "2026-11-11",
    left: known
      ? { known: true, payday: { date: "2026-11-25", name: "Työnantaja" }, days: 14, balanceCents: 500000, billsCents: 189954, leftCents: 310046, perDayCents: 22146 }
      : { known: false, reason: "no-payday" },
    usualPerDayCents: null,
    pace: { day: 11, spentCents: 123400, usual: null },
  };
  // only the parts Nyt reads; the rest of the answer is not drawn here
  const rest = {
    pace: { month: "2026-11", daysInMonth: 30, current: [], expected: null, projection: null, previous: null, largest: null, payDays: [] },
    ahead: null,
    home: { paceGap: null },
  } as unknown as DashboardData;
  return { ...rest, nyt };
}

const hrefs = (c: HTMLElement) => [...c.querySelectorAll("a.btn-link")].map((a) => [flat(a.textContent), a.getAttribute("href")]);

describe("Nyt figure links", () => {
  it("links the bills, the spent sum and the balance", () => {
    const { container } = render(createElement(Nyt, { data: data(true) }));
    const links = hrefs(container);
    expect(links).toContainEqual(["1 899,54 €", "#/bills#ennen-palkkapaivaa"]);
    expect(links).toContainEqual(["5 000,00 €", "#/reports?q=saldot"]);
    expect(links.some(([, h]) => h === "#/transactions?from=2026-11-01&to=2026-11-11")).toBe(true);
    expect(flat(container.querySelector(".nyt-parts")?.textContent)).toBe("Saldo 5 000,00 € − laskut ennen palkkapäivää 1 899,54 €");
  });

  it("draws only the spent link without a known sum", () => {
    const { container } = render(createElement(Nyt, { data: data(false) }));
    expect(hrefs(container).map(([, h]) => h)).toEqual(["#/transactions?from=2026-11-01&to=2026-11-11"]);
  });
});
