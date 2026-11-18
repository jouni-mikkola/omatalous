/** Yhteenveto's month (Tulot, Menot, Tulos and the use of the income) and the sum left to the payday. */
import { render } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Now } from "../src/components/home/Now.tsx";
import { Summary } from "../src/components/home/Summary.tsx";
import type { DashboardData } from "../src/types.ts";

type NytData = NonNullable<DashboardData["nyt"]>;
type Data = DashboardData & { nyt: NytData };

const flat = (s: string | null | undefined) => (s ?? "").replace(/[  ]/g, " ");
const TODAY = "2026-11-11";

function nytOf(known: boolean, billsCents = 189954, elsewhereCents = 0, paydayCents = 0): NytData {
  return {
    from: "2026-11-11",
    left: known
      ? { known: true, payday: { date: "2026-11-25", name: "Työnantaja" }, days: 14, balanceCents: 500000, billsCents, cardDebtCents: 0, leftCents: 500000 - billsCents, perDayCents: Math.round((500000 - billsCents) / 14), elsewhereCents, paydayCents }
      : { known: false, reason: "no-payday", found: 1 },
    usualPerDayCents: null,
    pace: { day: 11, spentCents: 123400, usual: null },
  };
}

const totalsOf = (incomeCents: number, consumptionCents: number, debtCents: number, savedCents: number) => ({
  incomeCents,
  consumptionCents,
  debtCents,
  expenseCents: consumptionCents + debtCents,
  savedCents,
  borrowedCents: 0,
  netCents: incomeCents - consumptionCents - debtCents,
  leftCents: incomeCents - consumptionCents - debtCents - savedCents,
});

function data(more: Partial<DashboardData> = {}): Data {
  // only the parts the blocks read; the rest of the answer is not drawn here. The month's bar holds a sum of its own (150000
  // against the pace's 123400), so a figure that read the pace or the nyt sum instead of the bar would show another one
  const rest = {
    range: { from: "2026-11-01", to: "2026-11-30", previousFrom: "2026-10-01" },
    comparable: true,
    running: true,
    totals: totalsOf(412000, 150000, 20000, 30000),
    previousTotals: totalsOf(380000, 140000, 20000, 30000),
    pace: { month: "2026-11", daysInMonth: 30, current: [], expected: null, projection: null, previous: null, largest: null, payDays: [] },
    ahead: { from: "2026-11-11", to: "2026-11-24", rows: [], upcoming: [], outside: [] },
    home: { paceGap: null, pace: null },
    holdings: { accounts: [], cards: [], loans: [], accountsCents: 1300000, debtCents: 60000, netCents: 1240000 },
    overview: { income: { cents: 412000, earnedCents: 398000 }, months: [{ month: "2026-11", incomeCents: 412000, spendCents: 150000, fromSavingsCents: 0, complete: false }] },
  } as unknown as DashboardData;
  return { ...rest, ...more, nyt: nytOf(true) };
}

function summaryIn(d: Data, today = TODAY) {
  const { container } = render(createElement(Summary, { data: d, today }));
  return container;
}

/** The three figures as a reader sees them: label, figure and the lines under it. */
const fillOf = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`[data-fig=${id}] .home-gauge-fill`)!;
const markOf = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`[data-fig=${id}] .home-gauge-mark`);
const size = (el: HTMLElement) => el.style.getPropertyValue("inline-size");
const figuresIn = (container: HTMLElement) =>
  [...container.querySelectorAll(".home-figs > li")].map((li) => ({
    id: li.getAttribute("data-fig"),
    label: li.querySelector(".home-fig-label")?.textContent,
    figure: flat(li.querySelector(".fig")?.textContent),
    lines: [...li.querySelectorAll(".home-fig-line")].map((l) => flat(l.textContent)),
  }));

describe("Yhteenveto's month", () => {
  it("names the month once and tells Tulot, Menot and Tulos in that order, each with its comparison", () => {
    const pace = { month: "2026-11", day: 11, daysInMonth: 30, spentCents: 123400, expectedCents: 100000, diffCents: 23400, lowCents: 90000, highCents: 110000, position: "above", end: null, months: 6 };
    const container = summaryIn(data({ home: { paceGap: null, pace } } as never));
    expect(container.querySelector("h2")?.textContent).toBe("Marraskuu 2026");
    expect(figuresIn(container)).toEqual([
      { id: "income", label: "Tulot", figure: "4 120 €", lines: ["Viime kuussa samaan päivään 3 800 €", "Ansiotulot 3 980 €"] },
      { id: "spent", label: "Menot ilman säästöistä maksettua", figure: "1 500 €", lines: ["234 € yli tavallisen tähän päivään"] },
      { id: "result", label: "Tulos", figure: "2 120 €", lines: ["Viime kuussa samaan päivään 1 900 €"] },
    ]);
  });

  it("the income names the earned part only when it differs from the income, and a month with only unearned income shows it", () => {
    const income = (cents: number, earnedCents: number) => figuresIn(summaryIn(data({ overview: { income: { cents, earnedCents }, months: [] } } as never)))[0]!;
    expect(income(412000, 412000).lines).toEqual(["Viime kuussa samaan päivään 3 800 €"]);
    expect(income(150000, 0)).toMatchObject({ figure: "1 500 €", lines: ["Viime kuussa samaan päivään 3 800 €", "Ansiotulot 0 €"] });
  });

  // Tulot less Menot was 570 € above Tulos in a month with 200 € taken out of savings, and the page never showed the 200 €
  it("Tulos names the terms between Menot and Tulos: money moved to or taken out of savings, credit drawn or paid back", () => {
    const terms = (totals: { incomeCents: number; expenseCents: number; borrowedCents?: number; leftCents?: number }) => {
      const overview = { income: { cents: totals.incomeCents, earnedCents: totals.incomeCents }, months: [{ month: "2026-11", incomeCents: totals.incomeCents, spendCents: totals.expenseCents, fromSavingsCents: 0, complete: false }] };
      return [...summaryIn(data({ totals, overview } as never)).querySelectorAll("[data-fig=result] .home-fig-term")].map((el) => flat(el.textContent));
    };
    expect(terms(totalsOf(412000, 150000, 20000, 30000))).toEqual(["Säästöön siirretty 300 €"]);
    expect(terms(totalsOf(342800, 150000, 20000, -20000))).toEqual(["Otettu säästöistä 200 €"]);
    expect(terms({ ...totalsOf(100000, 150000, 0, 0), borrowedCents: 40000, leftCents: -10000 })).toEqual(["Nostettu luottoa 400 €"]);
    expect(terms({ ...totalsOf(100000, 50000, 0, 0), borrowedCents: -40000, leftCents: 10000 })).toEqual(["Luottoa maksettu takaisin 400 €"]);
    expect(terms(totalsOf(412000, 150000, 20000, 0))).toEqual([]);
  });

  it("the terms are rounded with Tulot, Menot and Tulos, so the euros shown add up to the Tulos shown", () => {
    // 4 120,40 less 1 700,40 less 300,40 moved to savings plus 150,60 drawn on credit is 2 270,20: shown 4 120, 1 700, 2 270
    const totals = { ...totalsOf(412040, 150020, 20020, 30040), borrowedCents: 15060, leftCents: 227020 };
    const overview = { income: { cents: 412040, earnedCents: 412040 }, months: [{ month: "2026-11", incomeCents: 412040, spendCents: 170040, fromSavingsCents: 0, complete: false }] };
    const summary = summaryIn(data({ totals, overview } as never));
    expect([...summary.querySelectorAll("[data-fig=result] .home-fig-term")].map((el) => flat(el.textContent))).toEqual(["Säästöön siirretty 300 €", "Nostettu luottoa 150 €"]);
    const euros = (id: string) => Number(flat(summary.querySelector(`[data-fig=${id}] .fig`)?.textContent).replace(/[^\d−-]/g, "").replace("−", "-"));
    expect([euros("income"), euros("spent"), euros("result")]).toEqual([4120, 1700, 2270]);
    expect(euros("income") - euros("spent") - 300 + 150).toBe(euros("result"));
    // the same words in Tulojen käyttö show the same euros: 150,60 drawn on credit is 150 € there too
    const part = (key: string) => flat(summary.querySelector(`.home-flow-list [data-part=${key}] .home-flow-sum`)?.textContent);
    expect([part("saved"), part("credit-left")]).toEqual(["300 €", "150 €"]);
  });

  it("shows no term the rounding would turn to the other direction or to nothing", () => {
    // 0,60 moved to savings, but the whole euros of Tulot, Menot and Tulos leave 0 between them
    const totals = totalsOf(100049, 50051, 0, 60);
    const overview = { income: { cents: 100049, earnedCents: 100049 }, months: [{ month: "2026-11", incomeCents: 100049, spendCents: 50051, fromSavingsCents: 0, complete: false }] };
    const summary = summaryIn(data({ totals, overview } as never));
    expect([...summary.querySelectorAll("[data-fig=result] .home-fig-term")]).toEqual([]);
    // and Tulojen käyttö names no part for it either: no row stands where its term does not
    expect(summary.querySelector(".home-flow-list [data-part=saved]")).toBeNull();
  });

  it("the figures hold no link or button: no list holds a month's Tulos", () => {
    const container = summaryIn(data());
    expect(container.querySelectorAll(".home-figs a, .home-figs button").length).toBe(0);
  });

  // the chart's words said it of a shorter month before; the figure said "to the same day" of the whole month. Tulot and Tulos
  // said "to the same day" on 30.4., which reads all of March, while Menot said "all of last month"
  describe("the words of the month before", () => {
    /** The month `today` is in, running, with the month before read the way the server reads it (Tulot, Tulos, Menot all from the data's own window). */
    function onDay(today: string) {
      const [year, month] = today.slice(0, 7).split("-").map(Number) as [number, number];
      const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const before = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
      const curve = Array.from({ length: new Date(Date.UTC(year, month - 1, 0)).getUTCDate() }, () => 140000);
      const d = data({
        range: { from: `${today.slice(0, 7)}-01`, to: `${today.slice(0, 7)}-${last}`, previousFrom: `${before}-01` },
        pace: { ...data().pace, month: today.slice(0, 7), previous: { month: before, curve, day: Math.min(Number(today.slice(8)), curve.length), toToday: 140000 } },
      } as never);
      return summaryIn({ ...d, nyt: { ...d.nyt, pace: { ...d.nyt.pace, day: Number(today.slice(8)) } } }, today);
    }
    const linesOf = (container: HTMLElement) => figuresIn(container).map((f) => f.lines[0]);
    const SAME = ["Viime kuussa samaan päivään 3 800 €", "Viime kuussa samaan päivään 1 400 €", "Viime kuussa samaan päivään 1 900 €"];
    const WHOLE = ["Koko viime kuussa 3 800 €", "Koko viime kuussa 1 400 €", "Koko viime kuussa 1 900 €"];

    it("mid-month all three figures read to the same day", () => {
      expect(linesOf(onDay("2026-11-11"))).toEqual(SAME);
      // a month before as long as today's day of the month is still read to the same day
      expect(linesOf(onDay("2026-04-29"))).toEqual(SAME);
    });

    // January is a month like the others: the figures before it are December's (1.1.–15.1. against 1.12.–15.12.), not January's of the year before
    it("in January all three figures read December to the same day, on the 15th and on the 31st", () => {
      expect(linesOf(onDay("2026-01-15"))).toEqual(SAME);
      expect(linesOf(onDay("2026-01-31"))).toEqual(SAME);
    });

    it("on the 30th of April all three figures read all of March", () => {
      expect(linesOf(onDay("2026-04-30"))).toEqual(WHOLE);
    });

    it("on the 31st of May all three figures read all of April", () => {
      expect(linesOf(onDay("2026-05-31"))).toEqual(WHOLE);
    });

    it("on the last day of a short February all three figures read all of January", () => {
      expect(linesOf(onDay("2026-02-28"))).toEqual(WHOLE);
    });

    it("a month that is over reads all of the month before, also when both end on the 31st", () => {
      const d = data({
        running: false,
        range: { from: "2026-08-01", to: "2026-08-31", previousFrom: "2026-07-01" },
        pace: { ...data().pace, month: "2026-08", previous: { month: "2026-07", curve: [], day: 31, toToday: 140000 } },
      } as never);
      expect(figuresIn(summaryIn(d))[1]!.lines[0]).toBe("Koko viime kuussa 1 400 €");
    });

    it("a month before shorter than today's day is read whole, the 31st of October against September", () => {
      expect(linesOf(onDay("2026-10-31"))).toEqual(WHOLE);
      expect(linesOf(onDay("2026-03-30"))).toEqual(WHOLE);
    });
  });

  it("without a comparison the figures say what they wait for or nothing", () => {
    const d = data({ comparable: false, home: { paceGap: "history", pace: null } } as never);
    const [income, spent, result] = figuresIn(summaryIn(d));
    expect(income!.lines).toEqual(["Ansiotulot 3 980 €"]);
    expect(spent!.lines).toEqual(["Vertailu näkyy, kun takana on kolme päättynyttä kuukautta"]);
    expect(result!.lines).toEqual([]);
  });

  // 1.0.0 showed the sum left as a plain figure when the bills took more than the balance
  it("a negative Tulos is the problem colour", () => {
    const container = summaryIn(data({ totals: totalsOf(100000, 150000, 20000, 0) } as never));
    expect(container.querySelector("[data-fig=result]")?.classList.contains("home-short")).toBe(true);
    expect(flat(container.querySelector("[data-fig=result] .fig")?.textContent)).toBe("−700 €");
    expect(container.querySelector("[data-fig=income]")?.classList.contains("home-short")).toBe(false);
  });

  it("draws Tulot, Menot and Tulos on one scale, the longest sum the bars and their comparisons hold", () => {
    const container = summaryIn(data());
    expect(figuresIn(container).map((f) => size(fillOf(container, f.id!)))).toEqual(["100%", "36.4%", "51.5%"]);
    // the same day of last month: Tulot 3 800 €, Tulos 1 900 €, on the scale of 4 120 €; Menot has none to draw
    expect(figuresIn(container).map((f) => markOf(container, f.id!)?.style.getPropertyValue("inset-inline-start") ?? null)).toEqual(["92.2%", null, "46.1%"]);
  });

  it("the same sum kept and short are not the same bar: a negative Tulos fills from the far end in the problem tone", () => {
    const kept = summaryIn(data({ totals: totalsOf(190000, 100000, 20000, 0), comparable: false } as never));
    const short = summaryIn(data({ totals: totalsOf(100000, 150000, 20000, 0), comparable: false } as never));
    // +700 € and −700 € are the same length; the end they fill from and the tone tell them apart
    expect(size(fillOf(kept, "result"))).toBe("17%");
    expect(size(fillOf(short, "result"))).toBe("17%");
    expect(fillOf(kept, "result").hasAttribute("data-deficit")).toBe(false);
    expect(fillOf(kept, "result").closest(".home-gauge")?.getAttribute("data-tone")).toBe("income");
    expect(fillOf(short, "result").hasAttribute("data-deficit")).toBe(true);
    expect(fillOf(short, "result").closest(".home-gauge")?.getAttribute("data-tone")).toBe("debt");
  });

  it("draws the comparison of a negative Tulos from the same end, and leaves it out when last month was on the other side of zero", () => {
    const short = { overview: { income: { cents: 100000, earnedCents: 100000 }, months: [{ month: "2026-11", incomeCents: 100000, spendCents: 170000, fromSavingsCents: 0, complete: false }] }, totals: totalsOf(100000, 150000, 20000, 0) };
    // last month short by 500 €: both on the scale of Menot's 1 700 €
    const both = summaryIn(data({ ...short, previousTotals: totalsOf(100000, 130000, 20000, 0) } as never));
    expect(size(fillOf(both, "result"))).toBe("41.2%");
    expect(markOf(both, "result")?.style.getPropertyValue("inset-inline-end")).toBe("29.4%");
    expect(markOf(both, "result")?.style.getPropertyValue("inset-inline-start")).toBe("");
    // last month kept 1 900 €: a mark of a surplus on a bar of a shortfall is not drawn, its line stays
    const other = summaryIn(data({ ...short, previousTotals: totalsOf(380000, 140000, 20000, 30000) } as never));
    expect(markOf(other, "result")).toBeNull();
    expect(figuresIn(other)[2]!.lines).toEqual(["Viime kuussa samaan päivään 1 900 €"]);
    // the comparison of Tulot stays
    expect(markOf(other, "income")).not.toBeNull();
  });

  it("tells where the income went as the bridge of Raportit does: each part with its sum", () => {
    // the month's bar holds the same Menot as the totals (1 500 + 200), as it does in a real answer: the terms under Tulos and this list share one rounding
    const overview = { income: { cents: 412000, earnedCents: 398000 }, months: [{ month: "2026-11", incomeCents: 412000, spendCents: 170000, fromSavingsCents: 0, complete: false }] };
    const container = summaryIn(data({ overview } as never));
    const parts = [...container.querySelectorAll(".home-flow-list > li")].map((li) => ({
      part: li.getAttribute("data-part"),
      name: li.querySelector(".home-flow-name")?.textContent,
      sum: flat(li.querySelector(".home-flow-sum")?.textContent),
    }));
    expect(parts).toEqual([
      { part: "consumption", name: "Kulutus", sum: "1 500 €" },
      { part: "debt", name: "Maksettu velanhoito", sum: "200 €" },
      { part: "saved", name: "Säästöön siirretty", sum: "300 €" },
      { part: "left", name: "Tulos", sum: "2 120 €" },
    ]);
    expect(container.querySelectorAll(".home-flow-bar > span").length).toBe(4);
    expect(container.querySelector("[data-bar=sources]")).toBeNull();
  });

  it("tells the debt service as interest, what is not split, a subtotal and the repayments, in the order of the bridge", () => {
    const overview = { income: { cents: 412000, earnedCents: 398000 }, months: [{ month: "2026-11", incomeCents: 412000, spendCents: 170000, fromSavingsCents: 0, complete: false }] };
    const container = summaryIn(data({ overview, split: { interestCents: 5000, principalCents: 12000, unsplitCents: 3000 } } as never));
    const parts = [...container.querySelectorAll(".home-flow-list > li")].map((li) => [li.getAttribute("data-part"), li.querySelector(".home-flow-name")?.textContent, flat(li.querySelector(".home-flow-sum")?.textContent)]);
    expect(parts).toEqual([
      ["consumption", "Kulutus", "1 500 €"],
      ["interest", "Korot ja luottokulut", "50 €"],
      ["debt", "Velanhoito, erittelemättä", "30 €"],
      ["subtotal", "Välisumma", "2 540 €"],
      ["principal", "Lyhennykset", "120 €"],
      ["saved", "Säästöön siirretty", "300 €"],
      ["left", "Tulos", "2 120 €"],
    ]);
  });

  const barOf = (container: HTMLElement, which: string) =>
    [...container.querySelectorAll<HTMLElement>(`[data-bar=${which}] > span`)].map((s) => ({ part: s.getAttribute("data-part"), tone: s.getAttribute("data-tone"), share: Number.parseFloat(s.style.getPropertyValue("flex-grow")) }));
  const rowsOf = (container: HTMLElement) => [...container.querySelectorAll(".home-flow-list > li")].map((li) => [li.getAttribute("data-part"), flat(li.querySelector(".home-flow-name")?.textContent), flat(li.querySelector(".home-flow-sum")?.textContent)]);

  it("when spending is more than the income and savings covered the rest, a bar of the sources is drawn above the parts", () => {
    // 1 500 € out of 1 000 € income: 200 € came out of savings, 300 € from the accounts
    const container = summaryIn(data({ totals: totalsOf(100000, 150000, 0, -20000) } as never));
    const sources = barOf(container, "sources");
    expect(sources.map((s) => s.part)).toEqual(["income", "savings", "accounts"]);
    expect(sources.map((s) => s.tone)).toEqual(["income", "neutral", "neutral"]);
    expect(sources.map((s) => Math.round(s.share * 1000) / 1000)).toEqual([0.667, 0.133, 0.2]);
    expect(barOf(container, "parts").map((s) => s.part)).toEqual(["consumption"]);
    expect(rowsOf(container)).toEqual([["consumption", "Kulutus", "1 500 €"], ["savings", "Katettu säästöistä", "200 €"], ["accounts", "Katettu tileiltä", "300 €"]]);
  });

  it("when credit covered the gap the sources bar names the credit before the accounts", () => {
    const container = summaryIn(data({ totals: { ...totalsOf(100000, 150000, 0, 0), borrowedCents: 40000, leftCents: -10000 } } as never));
    expect(barOf(container, "sources").map((s) => s.part)).toEqual(["income", "credit", "accounts"]);
    expect(rowsOf(container).map((r) => r[0])).toEqual(["consumption", "credit", "accounts"]);
    expect(rowsOf(container)[1]).toEqual(["credit", "Katettu luotolla", "400 €"]);
  });

  // 1 928 € stayed of 3 428 € income and 200 € taken out of savings: the list names the 200 €, and the shares are of the 3 628 € together
  it("names what was taken out of savings and stayed, and the shares of the parts add up to 100", () => {
    // Tulot 3 428, Menot 1 700 (the consumption and the debt), Tulos 1 928: the 200 € between them is the savings drawn
    const overview = { income: { cents: 342800, earnedCents: 342800 }, months: [{ month: "2026-11", incomeCents: 342800, spendCents: 170000, fromSavingsCents: 0, complete: false }] };
    const container = summaryIn(data({ totals: totalsOf(342800, 150000, 20000, -20000), overview } as never));
    expect(rowsOf(container)).toEqual([["savings-left", "Otettu säästöistä", "200 €"], ["consumption", "Kulutus", "1 500 €"], ["debt", "Maksettu velanhoito", "200 €"], ["left", "Tulos", "1 928 €"]]);
    const shares = [...container.querySelectorAll(".home-flow-share")].map((el) => Number.parseInt(flat(el.textContent), 10)).filter((n) => !Number.isNaN(n));
    expect(shares.reduce((sum, n) => sum + n, 0)).toBe(100);
  });

  // a part of the list is never a negative sum: money taken out of savings or paid back to credit stands as the part that names it, positive, and the saved and drawn parts of the other direction are no row
  it("a negative saved term shows as money taken out of savings: the same euros under Tulos and in the list, and no negative row", () => {
    // 200,40 taken out of savings: Tulot 3 428, Menot 1 700, Tulos 1 928 in whole euros, so 200 € stands between them
    const overview = { income: { cents: 342800, earnedCents: 342800 }, months: [{ month: "2026-11", incomeCents: 342800, spendCents: 170000, fromSavingsCents: 0, complete: false }] };
    const container = summaryIn(data({ totals: totalsOf(342800, 150000, 20000, -20040), overview } as never));
    expect([...container.querySelectorAll("[data-fig=result] .home-fig-term")].map((el) => flat(el.textContent))).toEqual(["Otettu säästöistä 200 €"]);
    expect(rowsOf(container)).toEqual([["savings-left", "Otettu säästöistä", "200 €"], ["consumption", "Kulutus", "1 500 €"], ["debt", "Maksettu velanhoito", "200 €"], ["left", "Tulos", "1 928 €"]]);
    expect(container.querySelector(".home-flow-list [data-part=saved]")).toBeNull();
    expect(flat(container.querySelector(".home-flow-list")?.textContent)).not.toContain("−");
  });

  it("a negative credit term shows as credit paid back: the same euros under Tulos and in the list, and no row of credit drawn", () => {
    const overview = { income: { cents: 100000, earnedCents: 100000 }, months: [{ month: "2026-11", incomeCents: 100000, spendCents: 50000, fromSavingsCents: 0, complete: false }] };
    const container = summaryIn(data({ totals: { ...totalsOf(100000, 50000, 0, 0), borrowedCents: -40000, leftCents: 10000 }, overview } as never));
    expect([...container.querySelectorAll("[data-fig=result] .home-fig-term")].map((el) => flat(el.textContent))).toEqual(["Luottoa maksettu takaisin 400 €"]);
    expect(rowsOf(container)).toEqual([["consumption", "Kulutus", "500 €"], ["repaid", "Luottoa maksettu takaisin", "400 €"], ["left", "Tulos", "100 €"]]);
    expect(container.querySelector(".home-flow-list [data-part=credit-left]")).toBeNull();
  });

  it("draws no bar with no income, and the parts stand as a list alone", () => {
    const container = summaryIn(data({ totals: totalsOf(0, 150000, 0, 0) } as never));
    expect(container.querySelector(".home-flow-bar")).toBeNull();
    expect(container.querySelectorAll(".home-flow-list > li").length).toBeGreaterThan(0);
  });
});

describe("Yhteenveto's sum left to the payday", () => {
  const left = (d: Data) => {
    const { container } = render(createElement(Now, { data: d }));
    return container.querySelector<HTMLElement>("[data-tile=left]")!;
  };

  it("is the one link to the table of Laskut, with the sum a day and the payday", () => {
    const el = left(data());
    expect(el.getAttribute("href")).toBe("#/bills#laskut-taulukko");
    expect(el.querySelector(".home-fig-label")?.textContent).toBe("Käytettävissä palkkapäivään");
    expect(flat(el.querySelector(".fig")?.textContent)).toBe("3 100 €");
    expect(flat(el.querySelector(".home-fig-line")?.textContent)).toBe("221 € päivässä, palkkapäivä 25.11.");
  });

  it("on the payday says so, not the whole sum as a day's", () => {
    const d = data();
    const today = { ...d.nyt, left: { ...(d.nyt.left as Extract<NytData["left"], { known: true }>), days: 0, perDayCents: 310046 } };
    expect(flat(left({ ...d, nyt: today }).querySelector(".home-fig-line")?.textContent)).toBe("Palkkapäivä tänään");
  });

  it("without its sum says why", () => {
    const el = left({ ...data(), nyt: nytOf(false) });
    expect(flat(el.querySelector(".fig")?.textContent)).toBe("–");
    expect(el.querySelector(".home-fig-line")?.textContent).toBe("Palkkapäivä ei vielä tiedossa");
  });

  it("less left than the bills take is the problem colour", () => {
    const el = left({ ...data(), nyt: nytOf(true, 600000) });
    expect(el.classList.contains("home-short")).toBe(true);
    expect(flat(el.querySelector(".fig")?.textContent)).toBe("−1 000 €");
  });

  // the notice of the payday's bills stood under the answer; it is no line of the page any more
  it("tells nothing of the payday's own bills", () => {
    const { container } = render(createElement(Now, { data: { ...data(), nyt: nytOf(true, 0, 42182, 123456) } }));
    expect(container.textContent).not.toMatch(/Palkkapäivänä lähtee/);
  });
});
