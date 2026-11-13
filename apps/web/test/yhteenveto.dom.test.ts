/** Yhteenveto's blocks: the four tiles, the month's line and the categories, each opening its rows. */
import { fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { MonthPace } from "../src/components/home/MonthPace.tsx";
import { Tiles } from "../src/components/home/Tiles.tsx";
import { Where } from "../src/components/home/Where.tsx";
import type { DashboardData } from "../src/types.ts";
import { stubApi } from "./dom-kit.ts";

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

function nytOf(known: boolean, billsCents = 189954, elsewhereCents = 0, paydayCents = 0): NytData {
  return {
    from: "2026-11-11",
    left: known
      ? { known: true, payday: { date: "2026-11-25", name: "Työnantaja" }, days: 14, balanceCents: 500000, billsCents, leftCents: 500000 - billsCents, perDayCents: Math.round((500000 - billsCents) / 14), elsewhereCents, paydayCents }
      : { known: false, reason: "no-payday", found: 1 },
    usualPerDayCents: null,
    pace: { day: 11, spentCents: 123400, usual: null },
  };
}

function data(more: Partial<DashboardData> = {}): DashboardData & { nyt: NytData } {
  // only the parts the blocks read; the rest of the answer is not drawn here
  const rest = {
    pace: { month: "2026-11", daysInMonth: 30, current: [], expected: null, projection: null, previous: null, largest: null, payDays: [] },
    ahead: null,
    home: { paceGap: null, pace: null },
    top: { rows: [], otherCount: 0, otherCents: 0, totalCents: 0 },
    holdings: { accounts: [], cards: [], loans: [], accountsCents: 1300000, debtCents: 60000, netCents: 1240000 },
    overview: { income: { cents: 412000, usualCents: 398000 }, net: { since: "2026-10-11", changeCents: 34500 } },
  } as unknown as DashboardData;
  return { ...rest, ...more, nyt: nytOf(true) };
}

/** The tiles as a reader sees them: label, figure, line and where each leads. */
function tilesIn(d: DashboardData & { nyt: NytData }) {
  const { container } = render(createElement(Tiles, { data: d, scope: "own" }));
  return [...container.querySelectorAll(".home-tile")].map((a) => ({
    label: a.querySelector(".home-tile-label")?.textContent,
    figure: flat(a.querySelector(".fig")?.textContent),
    line: flat(a.querySelector(".home-tile-line")?.textContent) || null,
    href: a.getAttribute("href"),
  }));
}

describe("Yhteenveto", () => {
  it("four tiles: what is left to the payday a day, the month's spending and income against the usual, the net with its month's change, each opening its rows", () => {
    const pace = { month: "2026-11", day: 11, daysInMonth: 30, spentCents: 123400, expectedCents: 100000, diffCents: 23400, lowCents: 90000, highCents: 110000, position: "above", end: null, months: 6 };
    expect(tilesIn(data({ home: { paceGap: null, pace } } as never))).toEqual([
      { label: "Käytettävissä palkkapäivään", figure: "3 100 €", line: "221 € päivässä, palkkapäivä 25.11.", href: "#/bills#ennen-palkkapaivaa" },
      { label: "Menot tässä kuussa", figure: "1 234 €", line: "234 € yli tavallisen tähän päivään", href: "#/transactions?from=2026-11-01&to=2026-11-11" },
      { label: "Tulot tässä kuussa", figure: "4 120 €", line: "Tavallisesti 3 980 € kuussa", href: null },
      { label: "Varat velkojen jälkeen", figure: "12 400 €", line: "345 € enemmän kuin 11.10.", href: "#/reports?q=saldot" },
    ]);
  });

  // Tapahtumat's income takes in refunds and transfers the earned income leaves out: the tile opens the figure's own rows
  it("the income tile opens the rows of the earned income of the month to today", async () => {
    stubApi({ "GET /api/explain": { figure: "income.earned", kind: "sum", cents: 412000, lines: [], rows: [], check: { kind: "sum", diffCents: 0 } } });
    const { container } = render(createElement(Tiles, { data: data(), scope: "own" }));
    const door = container.querySelector<HTMLButtonElement>("[data-tile=income] button.why-door")!;
    expect(flat(door.getAttribute("aria-label"))).toContain("Tulot tässä kuussa 4 120 €");
    fireEvent.click(door);
    expect(flat(document.querySelector(".why-period")?.textContent)).toBe("1.–11.11.");
  });

  it("a tile without its figure says why, and one without a comparison says what it waits for", () => {
    const d = data({ home: { paceGap: "history", pace: null }, overview: { income: { cents: 0, usualCents: null }, net: null } } as never);
    const [left, spent, income, net] = tilesIn({ ...d, nyt: nytOf(false) });
    expect(left).toMatchObject({ figure: "–", line: "Palkkapäivä ei vielä tiedossa" });
    expect(spent!.line).toBe("Vertailu näkyy, kun takana on kolme päättynyttä kuukautta");
    expect(income!.line).toBe(spent!.line);
    expect(net!.line).toBeNull();
  });

  // 1.0.0 showed the sum left as a plain figure when the bills took more than the balance
  it("less left than the bills take is the tile's problem colour", () => {
    const d = data();
    const { container } = render(createElement(Tiles, { data: { ...d, nyt: nytOf(true, 600000) }, scope: "own" }));
    expect(container.querySelector("[data-tile=left] .home-tile")?.classList.contains("home-short")).toBe(true);
    expect(flat(container.querySelector("[data-tile=left] .fig")?.textContent)).toBe("−1 000 €");
  });

  // the net figure holds no debt for a loan with no saved balance: the label said nothing of it
  it("the net tile's label names the loans its figure lacks, as Tilit ja saldot does", () => {
    const holdings = { accounts: [], cards: [], loans: [{ leftCents: 60000 }], accountsCents: 1300000, debtCents: 60000, netCents: 1240000, unsavedLoans: { count: 1, names: ["Rahoitus Oy"], paymentCents: 28900 } };
    expect(tilesIn(data({ holdings } as never))[3]!.label).toBe("Varat velkojen jälkeen (ilman 1 lainaa)");
  });

  // the notice of the payday's bills stood under the answer; it is no line of the page any more
  it("no tile tells the payday's own bills", () => {
    const { container } = render(createElement(Tiles, { data: { ...data(), nyt: nytOf(true, 0, 42182, 123456) }, scope: "own" }));
    expect(container.textContent).not.toMatch(/Palkkapäivänä lähtee/);
  });

  it("the month's line opens the month's rows and says which side of the usual it is on, with the usual sum and its range", () => {
    const plain = render(createElement(MonthPace, { data: data() }));
    expect([...plain.container.querySelectorAll(".home-pace-line a")].map((a) => a.getAttribute("href"))).toEqual(["#/transactions?from=2026-11-01&to=2026-11-11"]);
    plain.unmount();
    // without a usual level the sum is a line alone and the reason is the next one: they ran on as one sentence
    const gap = render(createElement(MonthPace, { data: data({ home: { paceGap: "cards", pace: null } } as never) }));
    expect(flat(gap.container.querySelector(".home-pace-line")?.textContent)).toMatch(/^Käytetty [\d ]+€$/);
    expect(flat(gap.container.querySelector(".home-pace-gap")?.textContent)).toBe("Emme näytä tavallista tasoa, koska aiempien kuukausien korttiostot puuttuvat.");
    gap.unmount();
    // the chart drew last month's line while the words named this month's sum alone: they name last month's to the same day
    const curveOf = (days: number, day: number, cents: number) => Array.from({ length: days }, (_, i) => (i < day - 1 ? 0 : cents));
    const previous = { month: "2026-10", curve: curveOf(31, 11, 244649), day: 11, toToday: 244649 };
    const before = render(createElement(MonthPace, { data: data({ home: { paceGap: "history", pace: null }, pace: { ...data().pace, previous } } as never) }));
    expect(flat(before.container.querySelector(".home-pace-line")?.textContent)).toBe("Käytetty 1 234 €, viime kuussa samaan päivään 2 446 €.");
    before.unmount();
    // the 31st after a month of 30 days: the sum is all of last month, not its 31st
    const whole = { month: "2026-11", curve: curveOf(30, 30, 300000), day: 30, toToday: 300000 };
    const last = data({ home: { paceGap: "history", pace: null }, pace: { ...data().pace, month: "2026-12", daysInMonth: 31, previous: whole } } as never);
    const end = render(createElement(MonthPace, { data: { ...last, nyt: { ...last.nyt, from: "2026-12-31", pace: { ...last.nyt.pace, day: 31 } } } }));
    expect(flat(end.container.querySelector(".home-pace-line")?.textContent)).toBe("Käytetty 1 234 €, koko viime kuussa 3 000 €.");
    end.unmount();
    const pace = { month: "2026-11", day: 11, daysInMonth: 30, spentCents: 123400, expectedCents: 100000, diffCents: 23400, lowCents: 90000, highCents: 110000, position: "above", end: null, months: 6 };
    const { container } = render(createElement(MonthPace, { data: data({ home: { paceGap: null, pace } } as never) }));
    expect(flat(container.querySelector(".home-pace-line")?.textContent)).toBe("Käytetty 1 234 €, 234 € yli tavallisen. Tavallisesti 1 000 € (900–1 100 €).");
    // the band says what is usual: the month before is not a line of this chart
    expect(container.querySelector(".pace-prev")).toBeNull();
  });

  it("a category bar opens the category's rows of the month and names its change in words", () => {
    const { container } = render(createElement(Where, { data: data({ top: TOP }) }));
    const rows = [...container.querySelectorAll("a.where-row")];
    expect(rows.map((a) => a.getAttribute("href"))).toEqual(["#/transactions?category=groceries&from=2026-11-01&to=2026-11-11", "#/transactions?category=car&from=2026-11-01&to=2026-11-11"]);
    expect(rows.map((a) => flat(a.querySelector(".where-change")?.firstChild?.textContent))).toEqual(["100 € vähemmän kuin viime kuussa", "ei viime kuussa"]);
    // the bar is the server's share, and a category with nothing last month has no mark
    expect((rows[0]!.querySelector(".where-fill") as HTMLElement).style.getPropertyValue("inline-size")).toBe("80%");
    expect(rows.map((a) => a.querySelectorAll(".where-mark").length)).toEqual([1, 0]);
    expect((rows[0]!.querySelector(".where-mark") as HTMLElement).style.getPropertyValue("inset-inline-start")).toBe("100%");
    expect(flat(container.querySelector(".where-foot")?.textContent)).toContain("3 muuta kategoriaa 71 €.");
  });
});
