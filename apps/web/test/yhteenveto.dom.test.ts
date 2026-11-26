/** Yhteenveto's month (Tulot, Menot, Käteen jäi and the use of the income) and the sum left to the payday. */
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
    home: { paceGap: null, pace: null, lowPoint: null, runway: { leftOnPayday: { known: false, reason: "history" } } },
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
const figuresIn = (container: HTMLElement) =>
  [...container.querySelectorAll(".home-figs > li")].map((li) => ({
    id: li.getAttribute("data-fig"),
    label: li.querySelector(".home-fig-label")?.textContent,
    figure: flat(li.querySelector(".fig")?.textContent),
    lines: [...li.querySelectorAll(".home-fig-line")].map((l) => flat(l.textContent)),
  }));

describe("Yhteenveto's month", () => {
  it("names the month once and tells Tulot, Menot and Käteen jäi in that order, each with its comparison", () => {
    const pace = { month: "2026-11", day: 11, daysInMonth: 30, spentCents: 123400, expectedCents: 100000, diffCents: 23400, lowCents: 90000, highCents: 110000, position: "above", end: null, months: 6 };
    const container = summaryIn(data({ home: { paceGap: null, pace } } as never));
    expect(container.querySelector("h2")?.textContent).toBe("Marraskuu 2026");
    expect(figuresIn(container)).toEqual([
      { id: "income", label: "Tulot", figure: "4 120 €", lines: ["Viime kuussa samaan päivään 3 800 €", "Ansiotulot 3 980 €"] },
      { id: "spent", label: "Menot", figure: "1 500 €", lines: ["234 € yli tavallisen tähän päivään"] },
      { id: "result", label: "Käteen jäi", figure: "2 120 €", lines: ["Viime kuussa samaan päivään 1 900 €"] },
    ]);
  });

  it("the income names the earned part only when it differs from the income, and a month with only unearned income shows it", () => {
    const income = (cents: number, earnedCents: number) => figuresIn(summaryIn(data({ overview: { income: { cents, earnedCents }, months: [] } } as never)))[0]!;
    expect(income(412000, 412000).lines).toEqual(["Viime kuussa samaan päivään 3 800 €"]);
    expect(income(150000, 0)).toMatchObject({ figure: "1 500 €", lines: ["Viime kuussa samaan päivään 3 800 €", "Ansiotulot 0 €"] });
  });

  // Tulot less Menot was 570 € above Käteen jäi in a month with 200 € taken out of savings, and the page never showed the 200 €
  it("Käteen jäi names the terms between Menot and Käteen jäi: money moved to or taken out of savings, credit drawn or paid back", () => {
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

  it("each term is its own sum to the euro, the same in Käteen jäi and in Tulojen käyttö; the figures shown may differ from their terms by a euro", () => {
    // 4 120,40 less 1 700,40 less 300,40 moved to savings plus 150,60 drawn on credit is 2 270,20: shown 4 120, 1 700, 2 270, the terms 300 and 151
    const totals = { ...totalsOf(412040, 150020, 20020, 30040), borrowedCents: 15060, leftCents: 227020 };
    const overview = { income: { cents: 412040, earnedCents: 412040 }, months: [{ month: "2026-11", incomeCents: 412040, spendCents: 170040, fromSavingsCents: 0, complete: false }] };
    const summary = summaryIn(data({ totals, overview } as never));
    expect([...summary.querySelectorAll("[data-fig=result] .home-fig-term")].map((el) => flat(el.textContent))).toEqual(["Säästöön siirretty 300 €", "Nostettu luottoa 151 €"]);
    const euros = (id: string) => Number(flat(summary.querySelector(`[data-fig=${id}] .fig`)?.textContent).replace(/[^\d−-]/g, "").replace("−", "-"));
    expect([euros("income"), euros("spent"), euros("result")]).toEqual([4120, 1700, 2270]);
    expect(Math.abs(euros("income") - euros("spent") - 300 + 151 - euros("result"))).toBeLessThanOrEqual(1);
    // the same parts in Tulojen käyttö are named without a sum: the terms above tell it once
    const part = (key: string) => summary.querySelector(`.home-flow-list [data-part=${key}]`);
    expect([part("saved"), part("credit-left")].map((li) => [li?.querySelector(".home-flow-name")?.textContent, flat(li?.querySelector(".home-flow-sum")?.textContent)])).toEqual([["Säästöön siirretty", ""], ["Nostettu luottoa", ""]]);
    expect(flat([...summary.querySelectorAll(".home-flow-list")].map((list) => list.textContent).join(" "))).not.toMatch(/151|300 €/);
  });

  // 150 € taken out of savings was 149 € under Käteen jäi, the remainder that made the whole euros add up
  it("names the sum taken out of savings as it is, not as what is left between the rounded figures", () => {
    // spending 4 107,83 of an income of 3 966: 150 taken out of savings, 141,83 of it covering the gap
    const totals = totalsOf(396600, 272500, 138283, -15000);
    const overview = { income: { cents: 396600, earnedCents: 396600 }, months: [{ month: "2026-11", incomeCents: 396600, spendCents: 410783, fromSavingsCents: 0, complete: false }] };
    const summary = summaryIn(data({ totals, overview } as never));
    expect([...summary.querySelectorAll("[data-fig=result] .home-fig-term")].map((el) => flat(el.textContent))).toEqual(["Otettu säästöistä 150 €"]);
    // the page tells one sum for it: the 150 € under Käteen jäi, and no second one is told
    expect(summary.querySelector("[data-part=gap]")).toBeNull();
    expect(summary.textContent).not.toContain("Menot ylittivät tulot");
    expect(summary.textContent).not.toMatch(/säästöistä 142/);
    // and no share is told: of the income alone the shares of this month add to more than 100 %
    expect([...summary.querySelectorAll(".home-flow-share")].map((el) => flat(el.textContent)).filter((s) => s !== "")).toEqual([]);
  });

  it("names the sum taken out of savings as under Käteen jäi when something else covered the gap too", () => {
    // 1 500 € out of 1 000 € income: 200 € out of savings (all of it in the gap), 300 € from the accounts
    const container = summaryIn(data({ totals: totalsOf(100000, 150000, 0, -20000) } as never));
    expect(container.querySelector("[data-part=gap]")).toBeNull();
    expect(flat(container.querySelector("[data-fig=result] .home-fig-term")?.textContent)).toBe("Otettu säästöistä 200 €");
  });

  it("shown shares never add to more than 100 %: with a gap there is no share column", () => {
    for (const totals of [totalsOf(396600, 272500, 138283, -15000), totalsOf(100000, 150000, 0, -20000), totalsOf(342800, 150000, 20000, -20000)]) {
      const container = summaryIn(data({ totals } as never));
      const shares = [...container.querySelectorAll(".home-flow-share")].map((el) => Number.parseInt(flat(el.textContent), 10)).filter((n) => !Number.isNaN(n));
      expect(shares.reduce((sum, n) => sum + n, 0)).toBeLessThanOrEqual(100);
    }
  });

  it("shows no term of under 50 cents", () => {
    const totals = totalsOf(100049, 50051, 0, 40);
    const overview = { income: { cents: 100049, earnedCents: 100049 }, months: [{ month: "2026-11", incomeCents: 100049, spendCents: 50051, fromSavingsCents: 0, complete: false }] };
    const summary = summaryIn(data({ totals, overview } as never));
    expect([...summary.querySelectorAll("[data-fig=result] .home-fig-term")]).toEqual([]);
    // and Tulojen käyttö names no part for it either: no row stands where its term does not
    expect(summary.querySelector(".home-flow-list [data-part=saved]")).toBeNull();
  });

  it("the figures hold no link or button: no list holds a month's Käteen jäi", () => {
    const container = summaryIn(data());
    expect(container.querySelectorAll(".home-figs a, .home-figs button").length).toBe(0);
  });

  // the chart's words said it of a shorter month before; the figure said "to the same day" of the whole month. Tulot and Käteen jäi
  // said "to the same day" on 30.4., which reads all of March, while Menot said "all of last month"
  describe("the words of the month before", () => {
    /** The month `today` is in, running, with the month before read the way the server reads it (Tulot, Käteen jäi, Menot all from the data's own window). */
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
  it("a negative Käteen jäi is the problem colour", () => {
    const container = summaryIn(data({ totals: totalsOf(100000, 150000, 20000, 0) } as never));
    expect(container.querySelector("[data-fig=result]")?.classList.contains("home-short")).toBe(true);
    expect(flat(container.querySelector("[data-fig=result] .fig")?.textContent)).toBe("−700 €");
    expect(container.querySelector("[data-fig=income]")?.classList.contains("home-short")).toBe(false);
  });

  it("draws no bar under a figure, the comparison is its line", () => {
    const container = summaryIn(data());
    expect(container.querySelector(".home-figs [class*=home-gauge], .home-figs .home-band")).toBeNull();
    expect(figuresIn(container)[2]!.lines).toEqual(["Viime kuussa samaan päivään 1 900 €"]);
  });

  it("tells where the income went as the bridge of Raportit does: each part with its sum", () => {
    // the month's bar holds the same Menot as the totals (1 500 + 200), as it does in a real answer: the terms under Käteen jäi and this list share one rounding
    const overview = { income: { cents: 412000, earnedCents: 398000 }, months: [{ month: "2026-11", incomeCents: 412000, spendCents: 170000, fromSavingsCents: 0, complete: false }] };
    const container = summaryIn(data({ overview } as never));
    const parts = [...container.querySelectorAll(".home-flow-list > li")].map((li) => ({
      part: li.getAttribute("data-part"),
      name: li.querySelector(".home-flow-name")?.textContent,
      sum: flat(li.querySelector(".home-flow-sum")?.textContent),
    }));
    expect(parts).toEqual([
      { part: "income", name: "Tulot", sum: "" },
      { part: "consumption", name: "Kulutus", sum: "1 500 €" },
      { part: "debt", name: "Maksettu velanhoito", sum: "200 €" },
      { part: "saved", name: "Säästöön siirretty", sum: "" },
      { part: "left", name: "Käteen jäi", sum: "" },
    ]);
    // two bars, Tuli (the income alone) and Meni, each named
    expect(barOf(container, "in").map((s) => s.part)).toEqual(["income"]);
    expect(barOf(container, "out").length).toBe(4);
    expect([...container.querySelectorAll(".home-flow-side-name")].map((el) => el.textContent)).toEqual(["Tuli", "Meni"]);
  });

  it("tells the debt service as interest, what is not split, a subtotal and the repayments, in the order of the bridge", () => {
    const overview = { income: { cents: 412000, earnedCents: 398000 }, months: [{ month: "2026-11", incomeCents: 412000, spendCents: 170000, fromSavingsCents: 0, complete: false }] };
    const container = summaryIn(data({ overview, split: { interestCents: 5000, principalCents: 12000, unsplitCents: 3000 } } as never));
    const parts = [...container.querySelectorAll(".home-flow-list > li")].map((li) => [li.getAttribute("data-part"), li.querySelector(".home-flow-name")?.textContent, flat(li.querySelector(".home-flow-sum")?.textContent)]);
    expect(parts).toEqual([
      ["income", "Tulot", ""],
      ["consumption", "Kulutus", "1 500 €"],
      ["interest", "Korot ja luottokulut", "50 €"],
      ["debt", "Velanhoito, erittelemättä", "30 €"],
      ["subtotal", "Välisumma", "2 540 €"],
      ["principal", "Lyhennykset", "120 €"],
      ["saved", "Säästöön siirretty", ""],
      ["left", "Käteen jäi", ""],
    ]);
  });

  function barOf(container: HTMLElement, which: string) {
    return [...container.querySelectorAll<HTMLElement>(`[data-bar=${which}] > span`)].map((s) => ({ part: s.getAttribute("data-part"), tone: s.getAttribute("data-tone"), share: Number.parseFloat(s.style.getPropertyValue("flex-grow")) }));
  }
  const rowsOf = (container: HTMLElement) => [...container.querySelectorAll(".home-flow-list > li")].map((li) => [li.getAttribute("data-part"), flat(li.querySelector(".home-flow-name")?.textContent), flat(li.querySelector(".home-flow-sum")?.textContent)]);

  it("when spending is more than the income and savings covered the rest, the bar of what came in has the sources and the bar of what went out the parts", () => {
    // 1 500 € out of 1 000 € income: 200 € came out of savings, 300 € from the accounts
    const container = summaryIn(data({ totals: totalsOf(100000, 150000, 0, -20000) } as never));
    const sources = barOf(container, "in");
    expect(sources.map((s) => s.part)).toEqual(["income", "savings", "accounts"]);
    expect(sources.map((s) => s.tone)).toEqual(["income", "neutral", "neutral"]);
    expect(sources.map((s) => Math.round(s.share * 1000) / 1000)).toEqual([0.667, 0.133, 0.2]);
    expect(barOf(container, "out").map((s) => s.part)).toEqual(["consumption"]);
    // the sources are named under their bar with their sums, as the parts of Meni are, and with no share (shares of the income alone would read as a total above 100 %)
    expect(rowsOf(container)).toEqual([["income", "Tulot", "1 000 €"], ["savings", "Säästöistä", "200 €"], ["accounts", "Tileiltä tai korteilta", "300 €"], ["consumption", "Kulutus", "1 500 €"]]);
    expect([...container.querySelectorAll(".home-flow-share")].map((el) => flat(el.textContent)).filter((s) => s !== "")).toEqual([]);
    expect(container.querySelector("[data-part=gap]")).toBeNull();
    expect(container.textContent).not.toContain("Menot ylittivät tulot");
  });

  it("says nothing of a gap when the income paid everything", () => {
    const container = summaryIn(data());
    expect(container.querySelector("[data-part=gap]")).toBeNull();
  });

  it("when credit covered the gap the bar of what came in names the credit before the accounts", () => {
    const container = summaryIn(data({ totals: { ...totalsOf(100000, 150000, 0, 0), borrowedCents: 40000, leftCents: -10000 } } as never));
    expect(barOf(container, "in").map((s) => s.part)).toEqual(["income", "credit", "accounts"]);
    expect(rowsOf(container)).toEqual([["income", "Tulot", "1 000 €"], ["credit", "Luotosta", "400 €"], ["accounts", "Tileiltä tai korteilta", "100 €"], ["consumption", "Kulutus", "1 500 €"]]);
    expect(container.querySelector("[data-part=gap]")).toBeNull();
  });

  // credit drew 800 € against a gap of 500 €: 300 € stayed
  it("tells no sentence about the gap when credit covered it and money stayed over", () => {
    const container = summaryIn(data({ totals: { ...totalsOf(100000, 150000, 0, 0), borrowedCents: 80000, leftCents: 30000 } } as never));
    expect(flat(container.querySelector("[data-fig=result] .fig")?.textContent)).toBe("300 €");
    expect(container.querySelector("[data-part=gap]")).toBeNull();
    expect(container.textContent).not.toContain("Käteen jäi on se");
  });

  // 1 928 € stayed of 3 428 € income and 200 € taken out of savings: the list names the 200 €, and the shares are of the 3 628 € together
  it("names what was taken out of savings and stayed, and the shares of the parts add up to 100", () => {
    // Tulot 3 428, Menot 1 700 (the consumption and the debt), Käteen jäi 1 928: the 200 € between them is the savings drawn
    const overview = { income: { cents: 342800, earnedCents: 342800 }, months: [{ month: "2026-11", incomeCents: 342800, spendCents: 170000, fromSavingsCents: 0, complete: false }] };
    const container = summaryIn(data({ totals: totalsOf(342800, 150000, 20000, -20000), overview } as never));
    expect(rowsOf(container)).toEqual([["income", "Tulot", ""], ["savings-left", "Otettu säästöistä", ""], ["consumption", "Kulutus", "1 500 €"], ["debt", "Maksettu velanhoito", "200 €"], ["left", "Käteen jäi", ""]]);
    const shares = [...container.querySelectorAll(".home-flow-share")].map((el) => Number.parseInt(flat(el.textContent), 10)).filter((n) => !Number.isNaN(n));
    expect(shares.reduce((sum, n) => sum + n, 0)).toBe(100);
  });

  // a part of the list is never a negative sum: money taken out of savings or paid back to credit stands as the part that names it, positive, and the saved and drawn parts of the other direction are no row
  it("a negative saved term shows as money taken out of savings: the same euros under Käteen jäi and in the list, and no negative row", () => {
    // 200,40 taken out of savings: Tulot 3 428, Menot 1 700, Käteen jäi 1 928 in whole euros, so 200 € stands between them
    const overview = { income: { cents: 342800, earnedCents: 342800 }, months: [{ month: "2026-11", incomeCents: 342800, spendCents: 170000, fromSavingsCents: 0, complete: false }] };
    const container = summaryIn(data({ totals: totalsOf(342800, 150000, 20000, -20040), overview } as never));
    expect([...container.querySelectorAll("[data-fig=result] .home-fig-term")].map((el) => flat(el.textContent))).toEqual(["Otettu säästöistä 200 €"]);
    expect(rowsOf(container)).toEqual([["income", "Tulot", ""], ["savings-left", "Otettu säästöistä", ""], ["consumption", "Kulutus", "1 500 €"], ["debt", "Maksettu velanhoito", "200 €"], ["left", "Käteen jäi", ""]]);
    expect(container.querySelector(".home-flow-list [data-part=saved]")).toBeNull();
    expect(flat([...container.querySelectorAll(".home-flow-list")].map((list) => list.textContent).join(" "))).not.toContain("−");
  });

  it("a negative credit term shows as credit paid back: the same euros under Käteen jäi and in the list, and no row of credit drawn", () => {
    const overview = { income: { cents: 100000, earnedCents: 100000 }, months: [{ month: "2026-11", incomeCents: 100000, spendCents: 50000, fromSavingsCents: 0, complete: false }] };
    const container = summaryIn(data({ totals: { ...totalsOf(100000, 50000, 0, 0), borrowedCents: -40000, leftCents: 10000 }, overview } as never));
    expect([...container.querySelectorAll("[data-fig=result] .home-fig-term")].map((el) => flat(el.textContent))).toEqual(["Luottoa maksettu takaisin 400 €"]);
    expect(rowsOf(container)).toEqual([["income", "Tulot", ""], ["consumption", "Kulutus", "500 €"], ["repaid", "Luottoa maksettu takaisin", ""], ["left", "Käteen jäi", ""]]);
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
  /** The question of the section the figure answers: its heading, named by the section. */
  const questionOf = (figure: HTMLElement) => figure.closest("section")!.querySelector("h2")?.textContent;

  it("is the one link to the table of Laskut, with the sum a day and the payday", () => {
    const el = left(data());
    expect(el.getAttribute("href")).toBe("#/bills#laskut-taulukko");
    expect(questionOf(el)).toBe("Käytettävissä palkkapäivään");
    expect(flat(el.querySelector(".fig")?.textContent)).toBe("3 100 €");
    expect(flat(el.querySelector(".home-fig-line")?.textContent)).toBe("221 € päivässä, palkkapäivä 25.11.");
  });

  describe("with the everyday spending expected", () => {
    type Runway = Extract<NonNullable<DashboardData["home"]["runway"]>["leftOnPayday"], { known: true }>;
    const runway = (over: Partial<Runway> = {}): Runway => ({ known: true, from: "2026-11-11", payday: { date: "2026-11-25", name: "Työnantaja" }, days: 14, balanceCents: 500000, freeCents: 310046, everydayCents: 38900, billedCents: 0, laterCents: 0, leftCents: 271146, lowCents: 250000, highCents: 290000, months: 6, ...over });
    const withRunway = (r: Runway, nyt: NytData = nytOf(true)) => left({ ...data(), nyt, home: { ...data().home, runway: { leftOnPayday: r } } as never });

    it("is the sum left on the payday after the everyday spending, with the payday and no sum a day", () => {
      const el = withRunway(runway());
      expect(el.getAttribute("href")).toBe("#/bills#laskut-taulukko");
      expect(questionOf(el)).toBe("Jää palkkapäivänä 25.11.");
      expect(flat(el.querySelector(".fig")?.textContent)).toBe("2 711 €");
      expect(el.querySelector(".home-fig-line")).toBeNull();
      expect(el.classList.contains("home-short")).toBe(false);
    });

    const ledgerOf = (r: Runway, sum: { balanceCents: number; paymentsCents: number; cardDebtCents: number; freeCents: number }) => {
      const d = data();
      const container = render(createElement(Now, { data: { ...d, nyt: nytOf(true), home: { ...d.home, runway: { leftOnPayday: r, sum } } } as never })).container;
      return { figure: flat(container.querySelector("[data-tile=left] .fig")?.textContent), rows: [...container.querySelectorAll(".home-ledger > div")].map((row) => [row.getAttribute("data-row"), flat(row.querySelector("dd")?.textContent)]) };
    };
    /** "−1 500,00 €" as cents, for the check that the rows reconcile with the figure. */
    const centsOf = (text: string) => Math.round(Number(text.replace(/[^\d,−-]/g, "").replace("−", "-").replace(",", ".")) * 100);

    it("shows the parts of the sum beside it to the cent, a part that is 0 left out, and they add up to the figure", () => {
      // 5 000 on the accounts less 1 500 of payments and 200 of card debt is 3 300 free; less 389,50 of everyday spending and 120,34 on cards 2 790,16 is left
      const { figure, rows } = ledgerOf(runway({ freeCents: 330000, everydayCents: 38950, billedCents: 12034, leftCents: 279016 }), { balanceCents: 500000, paymentsCents: 150000, cardDebtCents: 20000, freeCents: 330000 });
      expect(rows).toEqual([["balance", "5 000,00 €"], ["payments", "−1 500,00 €"], ["cards", "−200,00 €"], ["everyday", "−389,50 €"], ["billed", "−120,34 €"]]);
      expect(rows.reduce((sum, [, shown]) => sum + centsOf(shown!), 0)).toBe(279016);
      expect(figure).toBe("2 790 €");
      // a part that is 0 has no row
      expect(ledgerOf(runway({ freeCents: 350000, everydayCents: 100000, billedCents: 0, leftCents: 250000 }), { balanceCents: 500000, paymentsCents: 150000, cardDebtCents: 0, freeCents: 350000 }).rows.map((r) => r[0])).toEqual(["balance", "payments", "everyday"]);
    });

    it("tells each row to the cent, so the rows read the sum of the figure and not a euro or two over it", () => {
      // 1 000,60 less 200,20 less 200,20 is 600,20: rounded one by one the rows would read 1 001, 200 and 200 and add up to 601
      const { figure, rows } = ledgerOf(runway({ freeCents: 80040, everydayCents: 20020, billedCents: 0, leftCents: 60020 }), { balanceCents: 100060, paymentsCents: 20020, cardDebtCents: 0, freeCents: 80040 });
      expect(figure).toBe("600 €");
      expect(rows).toEqual([["balance", "1 000,60 €"], ["payments", "−200,20 €"], ["everyday", "−200,20 €"]]);
      expect(rows.reduce((sum, [, shown]) => sum + centsOf(shown!), 0)).toBe(60020);
    });

    it("below zero is the problem colour and says no more than the figure", () => {
      const el = withRunway(runway({ leftCents: -213761 }));
      expect(el.classList.contains("home-short")).toBe(true);
      expect(flat(el.querySelector(".fig")?.textContent)).toBe("−2 138 €");
      expect(el.querySelector(".home-fig-line")).toBeNull();
    });

    it("on the payday says so", () => {
      expect(flat(withRunway(runway({ days: 0 })).querySelector(".home-fig-line")?.textContent)).toBe("Palkkapäivä tänään");
    });
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
    // no sum a day below zero: the line tells what is missing
    expect(flat(el.querySelector(".home-fig-line")?.textContent)).toBe("puuttuu 1 000 € ennen palkkapäivää");
  });

  // the notice of the payday's bills stood under the answer; it is no line of the page any more
  it("tells nothing of the payday's own bills", () => {
    const { container } = render(createElement(Now, { data: { ...data(), nyt: nytOf(true, 0, 42182, 123456) } }));
    expect(container.textContent).not.toMatch(/Palkkapäivänä lähtee/);
  });
});
