/** Nyt's figures open their basis: the bills sum, the spent sum and the balance are links; the lines read as before. */
import { render } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Nyt } from "../src/components/home/Nyt.tsx";
import type { DashboardData } from "../src/types.ts";

type NytData = NonNullable<DashboardData["nyt"]>;

const flat = (s: string | null | undefined) => (s ?? "").replace(/[\u00a0\u202f]/g, " ");

const TOP: DashboardData["top"] = {
  rows: [
    { category: "groceries", label: "Ruokakauppa", cents: 40000, barShare: 0.8, previousCents: 50000, changeCents: -10000, change: "less", previousShare: 1 },
    { category: "car", label: "Auto", cents: 12000, barShare: 0.24, previousCents: 0, changeCents: 12000, change: "new", previousShare: 0 },
  ],
  otherCount: 3,
  otherCents: 7100,
  totalCents: 59100,
};

function data(known: boolean, more: Partial<DashboardData> = {}): DashboardData & { nyt: NytData } {
  const nyt: NytData = {
    from: "2026-11-11",
    left: known
      ? { known: true, payday: { date: "2026-11-25", name: "Työnantaja" }, days: 14, balanceCents: 500000, billsCents: 189954, leftCents: 310046, perDayCents: 22146 }
      : { known: false, reason: "no-payday", found: 1 },
    usualPerDayCents: null,
    pace: { day: 11, spentCents: 123400, usual: null },
  };
  // only the parts Nyt reads; the rest of the answer is not drawn here
  const rest = {
    pace: { month: "2026-11", daysInMonth: 30, current: [], expected: null, projection: null, previous: null, largest: null, payDays: [] },
    ahead: null,
    home: { paceGap: null, pace: null },
    top: { rows: [], otherCount: 0, otherCents: 0, totalCents: 0 },
    holdings: { accountsCents: null, debtCents: 0, netCents: null },
  } as unknown as DashboardData;
  return { ...rest, ...more, nyt };
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

  it("says which side of the usual the month is on, with the usual sum and its range", () => {
    const pace = { month: "2026-11", day: 11, daysInMonth: 30, spentCents: 123400, expectedCents: 100000, diffCents: 23400, lowCents: 90000, highCents: 110000, position: "above", end: null, months: 6 };
    const { container } = render(createElement(Nyt, { data: data(true, { home: { paceGap: null, pace } } as never) }));
    expect(flat(container.querySelector(".nyt-pace")?.textContent)).toBe("Käytetty 1 234 €, 234 € yli tavallisen. Tavallisesti 1 000 € (900–1 100 €).");
    // the band says what is usual: the month before is not a line of this chart
    expect(container.querySelector(".pace-prev")).toBeNull();
  });

  it("a category bar opens the category's rows of the month and names its change in words", () => {
    const { container } = render(createElement(Nyt, { data: data(true, { top: TOP }) }));
    const rows = [...container.querySelectorAll("a.where-row")];
    expect(rows.map((a) => a.getAttribute("href"))).toEqual(["#/transactions?category=groceries&from=2026-11-01&to=2026-11-11", "#/transactions?category=car&from=2026-11-01&to=2026-11-11"]);
    expect(rows.map((a) => flat(a.querySelector(".where-change")?.firstChild?.textContent))).toEqual(["100 € vähemmän kuin viime kuussa", "ei viime kuussa"]);
    // the bar is the server's share, and a category with nothing last month has no mark
    expect((rows[0]!.querySelector(".where-fill") as HTMLElement).style.getPropertyValue("inline-size")).toBe("80%");
    expect(rows.map((a) => a.querySelectorAll(".where-mark").length)).toEqual([1, 0]);
    expect((rows[0]!.querySelector(".where-mark") as HTMLElement).style.getPropertyValue("inset-inline-start")).toBe("100%");
    expect(flat(container.querySelector(".where-foot")?.textContent)).toContain("3 muuta luokkaa 71 €.");
  });

  it("the accounts and the debt each open their rows, with no net figure, and a loan without a saved balance is named with the way to save it", () => {
    const holdings = { accountsCents: 1300000, debtCents: 60000, netCents: 1240000 };
    const whole = render(createElement(Nyt, { data: data(true, { holdings } as never) }));
    expect([...whole.container.querySelectorAll(".home-figures dt")].map((e) => e.textContent)).toEqual(["Kaikkien tilien saldo", "Velkaa"]);
    expect([...whole.container.querySelectorAll(".home-figures dd a")].map((a) => a.getAttribute("href"))).toEqual(["#/reports?q=saldot", "#/reports?q=velat"]);
    expect(whole.container.querySelector(".nyt-unsaved")).toBeNull();
    whole.unmount();
    const missing = render(createElement(Nyt, { data: data(true, { holdings: { ...holdings, unsavedLoans: { count: 1, names: ["Rahoitus Oy"], paymentCents: 28900 } } } as never) }));
    expect(missing.container.querySelector(".nyt-unsaved")?.textContent).toContain("Lisäksi 1 laina, jonka saldoa ei ole tallennettu.");
    expect(missing.container.querySelector(".nyt-unsaved a")?.getAttribute("href")).toBe("#/review");
  });
});
