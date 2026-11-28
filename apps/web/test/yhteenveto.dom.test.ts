/** Yhteenveto's month (Tulot, Menot and Käteen jäi) and the sum left to the payday. */
import { render } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { HoldingsLines } from "../src/components/home/HoldingsLines.tsx";
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

  it("each term is its own sum to the euro, the figures shown may differ from their terms by a euro", () => {
    // 4 120,40 less 1 700,40 less 300,40 moved to savings plus 150,60 drawn on credit is 2 270,20: shown 4 120, 1 700, 2 270, the terms 300 and 151
    const totals = { ...totalsOf(412040, 150020, 20020, 30040), borrowedCents: 15060, leftCents: 227020 };
    const overview = { income: { cents: 412040, earnedCents: 412040 }, months: [{ month: "2026-11", incomeCents: 412040, spendCents: 170040, fromSavingsCents: 0, complete: false }] };
    const summary = summaryIn(data({ totals, overview } as never));
    expect([...summary.querySelectorAll("[data-fig=result] .home-fig-term")].map((el) => flat(el.textContent))).toEqual(["Säästöön siirretty 300 €", "Nostettu luottoa 151 €"]);
    const euros = (id: string) => Number(flat(summary.querySelector(`[data-fig=${id}] .fig`)?.textContent).replace(/[^\d−-]/g, "").replace("−", "-"));
    expect([euros("income"), euros("spent"), euros("result")]).toEqual([4120, 1700, 2270]);
    expect(Math.abs(euros("income") - euros("spent") - 300 + 151 - euros("result"))).toBeLessThanOrEqual(1);
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
  });

  it("names the sum taken out of savings as under Käteen jäi when something else covered the gap too", () => {
    // 1 500 € out of 1 000 € income: 200 € out of savings (all of it in the gap), 300 € from the accounts
    const container = summaryIn(data({ totals: totalsOf(100000, 150000, 0, -20000) } as never));
    expect(container.querySelector("[data-part=gap]")).toBeNull();
    expect(flat(container.querySelector("[data-fig=result] .home-fig-term")?.textContent)).toBe("Otettu säästöistä 200 €");
  });

  it("shows no term of under 50 cents", () => {
    const totals = totalsOf(100049, 50051, 0, 40);
    const overview = { income: { cents: 100049, earnedCents: 100049 }, months: [{ month: "2026-11", incomeCents: 100049, spendCents: 50051, fromSavingsCents: 0, complete: false }] };
    const summary = summaryIn(data({ totals, overview } as never));
    expect([...summary.querySelectorAll("[data-fig=result] .home-fig-term")]).toEqual([]);
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
    const runway = (over: Partial<Runway> = {}): Runway => ({ known: true, from: "2026-11-11", payday: { date: "2026-11-25", name: "Työnantaja" }, days: 14, balanceCents: 500000, freeCents: 310046, everydayCents: 38900, billedCents: 0, laterCents: 0, leftCents: 271146, lowCents: 250000, highCents: 290000, months: 6, parts: { balanceCents: 500000, bills: { cents: -189954, count: 1 }, cardBills: { cents: 0, count: 0 }, spending: { cents: -38900, lowCents: -45000, highCents: -30000 }, laterCards: { cents: 0, count: 0 } }, ...over });
    const withRunway = (r: Runway, nyt: NytData = nytOf(true)) => left({ ...data(), nyt, home: { ...data().home, runway: { leftOnPayday: r } } as never });

    it("is the sum left on the payday after the everyday spending, with a verdict that names the payday and no sum a day", () => {
      const el = withRunway(runway());
      expect(questionOf(el)).toBe("Riittää palkkapäivään 25.11.");
      expect(flat(el.querySelector(".fig")?.textContent)).toBe("2 711 €");
      expect(el.closest("section")!.querySelector(".home-fig-line")).toBeNull();
      expect(el.closest("section")!.classList.contains("home-short")).toBe(false);
    });

    it("links the bills row to the table of Laskut", () => {
      const link = withRunway(runway()).closest("section")!.querySelector<HTMLElement>("[data-row=bills] a")!;
      expect(link.getAttribute("href")).toBe("#/bills#laskut-taulukko");
    });

    const ledgerOf = (r: Runway) => {
      const d = data();
      const container = render(createElement(Now, { data: { ...d, nyt: nytOf(true), home: { ...d.home, runway: { leftOnPayday: r } } } as never })).container;
      return {
        container,
        figure: flat(container.querySelector("[data-tile=left] .fig")?.textContent),
        rows: [...container.querySelectorAll(".home-rows > div")].map((row) => [row.getAttribute("data-row"), flat(row.querySelector("dd")?.textContent)]),
      };
    };
    /** "−1 500,00 €" as cents, for the check that the rows reconcile with the figure. */
    const centsOf = (text: string) => Math.round(Number(text.replace(/[^\d,−-]/g, "").replace("−", "-").replace(",", ".")) * 100);

    it("tells the parts to the cent as rows that are always open, a card row only when a card bill is there, and they add up to the figure", () => {
      // 5 000 on the accounts less 1 500 of bills, 320,50 of card bills and 389,50 of expected spending is 2 790 left
      const parts = { balanceCents: 500000, bills: { cents: -150000, count: 3 }, cardBills: { cents: -32050, count: 2 }, spending: { cents: -38950, lowCents: -45000, highCents: -30000 }, laterCards: { cents: 0, count: 0 } };
      const { figure, rows, container } = ledgerOf(runway({ leftCents: 279000, parts }));
      expect(rows).toEqual([["balance", "5 000,00 €"], ["bills", "−1 500,00 €"], ["cards", "−320,50 €"], ["spending", "−389,50 €"], ["left", "2 790 €"]]);
      expect(rows.slice(0, 4).reduce((sum, [, shown]) => sum + centsOf(shown!), 0)).toBe(279000);
      expect(figure).toBe("2 790 €");
      expect(container.querySelector("details")).toBeNull();
      // a card row has none without a card bill; the bills row tells how many
      expect(ledgerOf(runway()).rows.map((r) => r[0])).toEqual(["balance", "bills", "spending", "left"]);
      expect(flat(container.querySelector("[data-row=bills] dt")?.textContent)).toBe("Muut laskut ennen palkkapäivää 3 kpl");
      expect(flat(ledgerOf(runway()).container.querySelector("[data-row=bills] dt")?.textContent)).toBe("Laskut ennen palkkapäivää 1 kpl");
      expect(flat(container.querySelector("[data-row=cards] dt")?.textContent)).toBe("Korttilaskut ennen palkkapäivää 2 kpl");
      // no bills is no count: "0 kpl" would stand alone on its line
      const none = { ...parts, bills: { cents: 0, count: 0 } };
      expect(flat(ledgerOf(runway({ parts: none })).container.querySelector("[data-row=bills] dt")?.textContent)).toBe("Muut laskut ennen palkkapäivää");
    });

    it("marks the balance as Nyt and the spending and the sum left as Arvio, the range in the spending row", () => {
      const { container } = ledgerOf(runway());
      const chips = (row: string) => [...container.querySelectorAll(`[data-row=${row}] .kind-chip`)].map((c) => c.textContent);
      expect([chips("balance"), chips("bills"), chips("spending"), chips("left")]).toEqual([["Nyt"], [], ["Arvio"], ["Arvio"]]);
      expect(flat(container.querySelector("[data-row=spending] dt")?.textContent)).toBe("Arvioitu kulutus 14 pv Arvio tavallisesti 300–450 €");
    });

    it("tells a card debt whose bill is after the payday as one quiet line that takes nothing off", () => {
      const parts = { ...runway().parts, laterCards: { cents: 239800, count: 1 } };
      const { container, rows } = ledgerOf(runway({ parts }));
      expect(flat(container.querySelector(".home-later-cards")?.textContent)).toBe("Korttivelka 2 398 €, jonka maksat palkasta 25.11.");
      expect(rows.map((r) => r[0])).toEqual(["balance", "bills", "spending", "left"]);
      expect(ledgerOf(runway()).container.querySelector(".home-later-cards")).toBeNull();
    });

    it("below zero is the problem colour, the verdict tells the sum that is missing and the figure is the answer's", () => {
      const el = withRunway(runway({ leftCents: -213761 }));
      expect(el.closest("section")!.classList.contains("home-short")).toBe(true);
      expect(flat(questionOf(el))).toBe("Puuttuu 2 138 € ennen palkkapäivää");
      expect(flat(el.querySelector(".fig")?.textContent)).toBe("−2 138 €");
      // under 50 cents missing the verdict tells the cents, not 0 €
      expect(flat(questionOf(withRunway(runway({ leftCents: -30 }))))).toBe("Puuttuu 0,30 € ennen palkkapäivää");
      expect(el.closest("section")!.querySelector(".home-fig-line")).toBeNull();
    });

    it("on the payday says so", () => {
      expect(flat(withRunway(runway({ days: 0 })).querySelector(".home-row-note")?.textContent)).toBe("Palkkapäivä tänään");
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

describe("Yhteenveto's rail", () => {
  it("tells Tilit, Luottokortit and Lainat as one line each under one link to Varat ja velat, and leaves out a group the household has none of", () => {
    const holdings = { accounts: [{}], cards: [{}], loans: [], accountsCents: 1300000, cardsCents: -45000, loansCents: null } as unknown as DashboardData["holdings"];
    const { container } = render(createElement(HoldingsLines, { holdings }));
    expect([...container.querySelectorAll(".st-row")].map((row) => [flat(row.querySelector("dt")?.textContent), flat(row.querySelector("dd")?.textContent)])).toEqual([["Tilit", "13 000,00 €"], ["Luottokortit", "−450,00 €"]]);
    expect([...container.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["#/balances"]);

    // a debt lacks its balance: the sum names itself the known one and a line says so, linking to the question still asked
    const lacking = { ...holdings, unsavedLoans: { count: 1, rows: [{ debtId: "d1", asked: false }] } } as unknown as DashboardData["holdings"];
    const { container: missing } = render(createElement(HoldingsLines, { holdings: lacking }));
    expect(flat(missing.querySelectorAll(".st-row")[2]?.querySelector("dt")?.textContent)).toBe("Lainat yhteensä, tiedossa");
    expect(flat(missing.querySelector(".st-note")?.textContent)).toBe("1 velan saldo puuttuu.");
    expect(missing.querySelector(".st-note a")?.getAttribute("href")).toBe("#/review?item=loan-terms%3Ad1");
  });
});
