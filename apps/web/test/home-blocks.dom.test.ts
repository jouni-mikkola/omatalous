/** Yhteenveto's blocks under the tiles: the twelve months, the bills to the payday and the categories, each opening its rows. */
import { render } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Bills } from "../src/components/home/Bills.tsx";
import { Categories } from "../src/components/home/Categories.tsx";
import { Months } from "../src/components/home/Months.tsx";
import type { DashboardData } from "../src/types.ts";

type NytData = NonNullable<DashboardData["nyt"]>;
type Row = NonNullable<DashboardData["ahead"]>["rows"][number];

const flat = (s: string | null | undefined) => (s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();

const TODAY = "2026-11-11";
const monthsOf = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 10 - (n - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });

const MONTHS = monthsOf(12).map((month, i) => ({ month, incomeCents: 400000 + i * 100, spendCents: 300000 + i * 100, complete: i > 0 && i < 11 }));

const left = { known: true, payday: { date: "2026-11-25", name: "Työnantaja" }, days: 14, balanceCents: 500000, billsCents: 0, leftCents: 0, perDayCents: 0, elsewhereCents: 0, paydayCents: 0 };
const bill = (date: string, name: string, cents: number, source: Row["source"] = "recurring"): Row => ({ date, name, category: "bills", cents, source }) as Row;

function data(more: Record<string, unknown> = {}, nyt: Partial<NytData> = {}): DashboardData & { nyt: NytData } {
  const rest = {
    pace: { month: "2026-11" },
    ahead: { from: TODAY, to: "2026-11-24", reason: "payday", payday: { date: "2026-11-25" }, rows: [], upcoming: [], outside: [] },
    overview: { months: MONTHS, usualSpendCents: 214900, usualMonths: 10, usualLargeLeftOutCents: 0, categories: { rows: [], otherCents: 0, otherCount: 0, totalCents: 0, usualMonths: 0 } },
    ...more,
  } as unknown as DashboardData;
  return { ...rest, nyt: { from: TODAY, left, usualPerDayCents: null, pace: { day: 11, spentCents: 0, usual: null }, ...nyt } as NytData };
}

describe("Tulot ja menot", () => {
  it("draws twelve months, each a link to its rows, the running one to today", () => {
    const { container } = render(createElement(Months, { data: data(), today: TODAY }));
    const links = [...container.querySelectorAll("svg a")];
    expect(links).toHaveLength(12);
    expect(links[0]!.getAttribute("href")).toBe("#/transactions?from=2025-12-01&to=2025-12-31");
    expect(links[10]!.getAttribute("href")).toBe("#/transactions?from=2026-10-01&to=2026-10-31");
    expect(links[11]!.getAttribute("href")).toBe("#/transactions?from=2026-11-01&to=2026-11-11");
    // the link names the month and its two sums, so a reader who cannot see the bars hears them
    expect(flat(links[11]!.getAttribute("aria-label"))).toMatch(/^Marraskuu 2026.*Tulot 4 011 €.*Menot 3 011 €.*kesken/i);
    // the year stands under the first name and under January
    const years = [...container.querySelectorAll("svg text tspan")].map((s) => s.textContent).filter((s) => /^\d{4}$/.test(s ?? ""));
    expect(years).toEqual(["2025", "2026"]);
  });

  it("marks the running month and one the accounts do not cover from its 1st as not whole, and no other", () => {
    const { container } = render(createElement(Months, { data: data(), today: TODAY }));
    const groups = [...container.querySelectorAll(".mb-month")];
    expect(groups.map((g) => g.classList.contains("mb-partial"))).toEqual([true, ...Array(10).fill(false), true]);
    expect(flat(container.querySelector(".mb-now")?.textContent)).toMatch(/kesken$/);
  });

  it("draws the usual month as a line and names it in the key, and leaves both out without one", () => {
    const usual = render(createElement(Months, { data: data(), today: TODAY }));
    expect(usual.container.querySelector(".mb-usual")).not.toBeNull();
    expect(flat(usual.container.querySelector(".mb-key")?.textContent)).toContain("Tavallinen kuukausi 2 149 € (10 kuukauden keskiarvo)");
    expect(usual.container.textContent).not.toContain("isoja kertaostoja");
    usual.unmount();
    const large = render(createElement(Months, { data: data({ overview: { months: MONTHS, usualSpendCents: 214900, usualMonths: 10, usualLargeLeftOutCents: 150000, categories: { rows: [], otherCents: 0, otherCount: 0, totalCents: 0, usualMonths: 0 } } }), today: TODAY }));
    expect(flat(large.container.textContent)).toContain("Tavallinen kuukausi on ilman isoja kertaostoja, yhteensä 1 500 €.");
    large.unmount();
    const none = render(createElement(Months, { data: data({ overview: { months: MONTHS, usualSpendCents: null, usualMonths: 0, categories: { rows: [], otherCents: 0, otherCount: 0, totalCents: 0, usualMonths: 0 } } }), today: TODAY }));
    expect(none.container.querySelector(".mb-usual")).toBeNull();
    expect(flat(none.container.querySelector(".mb-key")?.textContent)).not.toContain("Tavallinen");
  });

  it("is nothing with no month", () => {
    const { container } = render(createElement(Months, { data: data({ overview: { months: [], usualSpendCents: null, usualMonths: 0, categories: { rows: [], otherCents: 0, otherCount: 0, totalCents: 0, usualMonths: 0 } } }), today: TODAY }));
    expect(container.innerHTML).toBe("");
  });
});

describe("Tulevat laskut", () => {
  const cells = (tr: Element) => [...tr.children].map((c) => flat(c.textContent)).filter(Boolean).join(" | ");
  const rowsIn = (container: HTMLElement) => [...container.querySelectorAll("tbody tr")].map(cells);
  const totalIn = (container: HTMLElement) => cells(container.querySelector("tfoot tr")!);

  it("lists the payments before the payday that the tile takes off, six of them, and the tile's own sum of them all", () => {
    const rows = [
      bill("2026-11-12", "Vuokra", -80000),
      bill("2026-11-13", "Sähkö", -6000),
      { ...bill("2026-11-14", "Palkka", 300000), source: "income" } as Row,
      bill("2026-11-15", "Puhelin", -2000),
      bill("2026-11-16", "Vakuutus", -3000),
      bill("2026-11-17", "Netti", -2500),
      bill("2026-11-18", "Kortti", -45000, "card"),
      bill("2026-11-19", "Lehti", -1500),
      bill("2026-11-25", "Laina", -50000),
    ];
    const d = data({ ahead: { ...data().ahead, rows } }, { left: { ...left, billsCents: 140000 } as NytData["left"] });
    const { container } = render(createElement(Bills, { data: d }));
    expect(rowsIn(container)).toEqual([
      // a bill of a series is the app's estimate, as Laskut marks it; a card's bill with no basis is the usual one
      "12.11. | Vuokra | ≈ 800 €",
      "13.11. | Sähkö | ≈ 60 €",
      "15.11. | Puhelin | ≈ 20 €",
      "16.11. | Vakuutus | ≈ 30 €",
      "17.11. | Netti | ≈ 25 €",
      "18.11. | Kortti | ≈ 450 €",
    ]);
    // the sum is the answer's, of all seven: the page adds up nothing
    expect(totalIn(container)).toBe("Yhteensä (1 muu lasku) | 1 400 €");
    expect(container.querySelector("h2 a")?.getAttribute("href")).toBe("#/bills#ennen-palkkapaivaa");
    expect(flat(container.querySelector(".home-block-note")?.textContent)).toBe("Palkkapäivään 25.11.");
  });

  it("with no bill to the payday still names what other accounts pay, with the answer's sum and a link to Laskut", () => {
    const outside = [{ ...bill("2026-11-16", "Laina", -42182), outside: true } as Row];
    const d = data({ ahead: { ...data().ahead, outside } }, { left: { ...left, elsewhereCents: 42182 } as NytData["left"] });
    const { container } = render(createElement(Bills, { data: d }));
    expect(flat(container.querySelector(".home-detail")?.textContent)).toBe("Ei laskuja ennen palkkapäivää");
    const note = container.querySelectorAll(".home-detail")[1]!;
    expect(flat(note.textContent)).toBe("Lisäksi 421,82 € tileiltä, joita saldo ei laske");
    expect(note.querySelector("a")?.getAttribute("href")).toBe("#/bills#ennen-palkkapaivaa");
  });

  it("says nothing of other accounts when none pays before the payday", () => {
    const { container } = render(createElement(Bills, { data: data() }));
    expect(container.querySelectorAll(".home-detail")).toHaveLength(1);
  });

  it("without a known payday lists Laskut's thirty days with their sum", () => {
    const upcoming = [bill("2026-11-20", "Vuokra", -80000, "expected"), bill("2026-12-01", "Sähkö", -6000)];
    const d = data({ ahead: { from: TODAY, to: "2026-12-10", reason: "none", payday: null, rows: [], upcoming, outside: [] } }, { left: { known: false, reason: "no-payday", found: 0 } as NytData["left"] });
    const { container } = render(createElement(Bills, { data: d }));
    expect(rowsIn(container)).toEqual(["20.11. | Vuokra | 800 €", "1.12. | Sähkö | ≈ 60 €"]);
    expect(totalIn(container)).toBe("Yhteensä | 860 €");
    expect(flat(container.querySelector(".home-block-note")?.textContent)).toBe("Seuraavat 30 päivää");
    expect(container.querySelector("h2 a")?.getAttribute("href")).toBe("#/bills#tulossa");
  });

  it("with a payday but no balance to start from lists the bills to that payday, and says so", () => {
    // two equal bills on one day are two rows
    const upcoming = [bill("2026-11-20", "Vuokra", -80000, "expected"), bill("2026-11-22", "Lehti", -1500), bill("2026-11-22", "Lehti", -1500), bill("2026-12-01", "Sähkö", -6000)];
    const ahead = { from: TODAY, to: "2026-11-24", reason: "payday", payday: { date: "2026-11-25" }, rows: [], upcoming, outside: [] };
    const d = data({ ahead }, { left: { known: false, reason: "no-balance" } as NytData["left"] });
    const { container } = render(createElement(Bills, { data: d }));
    expect(rowsIn(container)).toEqual(["20.11. | Vuokra | 800 €", "22.11. | Lehti | ≈ 15 €", "22.11. | Lehti | ≈ 15 €"]);
    expect(totalIn(container)).toBe("Yhteensä | 830 €");
    expect(flat(container.querySelector(".home-block-note")?.textContent)).toBe("Palkkapäivään 25.11.");
  });

  it("says when no bill comes before the payday, or in the thirty days without one", () => {
    const { container } = render(createElement(Bills, { data: data() }));
    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).toContain("Ei laskuja ennen palkkapäivää");
    const none = data({ ahead: { from: TODAY, to: "2026-12-10", reason: "none", payday: null, rows: [], upcoming: [], outside: [] } }, { left: { known: false, reason: "no-payday", found: 0 } as NytData["left"] });
    expect(render(createElement(Bills, { data: none })).container.textContent).toContain("Ei laskuja seuraavan 30 päivän aikana");
  });
});

describe("Menot kategorioittain", () => {
  const categories = {
    rows: [
      { category: "housing", label: "Asuminen", cents: 100000, usualCents: 100000 },
      { category: "groceries", label: "Ruokakauppa", cents: 50000, usualCents: 40000 },
      { category: "car", label: "Auto", cents: 20000, usualCents: null },
    ],
    otherCents: 7100,
    otherCount: 3,
    totalCents: 177100,
    usualMonths: 6,
  };

  it("opens each category's rows of the month, and sets the bars and the usual months on one scale", () => {
    const { container } = render(createElement(Categories, { data: data({ overview: { months: MONTHS, usualSpendCents: null, usualMonths: 0, categories } }) }));
    const rows = [...container.querySelectorAll<HTMLElement>("a.where-row")];
    expect(rows.map((a) => a.getAttribute("href"))).toEqual([
      "#/transactions?category=housing&from=2026-11-01&to=2026-11-11",
      "#/transactions?category=groceries&from=2026-11-01&to=2026-11-11",
      "#/transactions?category=car&from=2026-11-01&to=2026-11-11",
    ]);
    const fill = (a: HTMLElement) => a.querySelector<HTMLElement>(".where-fill")!;
    expect(rows.map((a) => fill(a).style.getPropertyValue("inline-size"))).toEqual(["100%", "50%", "20%"]);
    expect(rows.map((a) => a.querySelector<HTMLElement>(".where-mark")?.style.getPropertyValue("inset-inline-start") ?? null)).toEqual(["100%", "40%", null]);
    // past its usual month the bar is the darker ink; at it or under, the plain one
    expect(rows.map((a) => fill(a).classList.contains("more"))).toEqual([false, true, false]);
    expect(rows.map((a) => flat(a.querySelector(".where-change")?.textContent) || null)).toEqual(["tavallisesti 1 000 €", "tavallisesti 400 €", null]);
    expect(flat(container.querySelector(".where-foot")?.textContent)).toContain("Pystyviiva on kategorian tavallinen kuukausi (6 kuukauden keskiarvo). 3 muuta kategoriaa 71 €.");
  });

  it("is nothing before the month has spending", () => {
    const { container } = render(createElement(Categories, { data: data() }));
    expect(container.innerHTML).toBe("");
  });
});
