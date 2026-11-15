/** Yhteenveto's four tiles: each figure, its comparison and the page it leads to. */
import { render } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Tiles } from "../src/components/home/Tiles.tsx";
import type { DashboardData } from "../src/types.ts";

type NytData = NonNullable<DashboardData["nyt"]>;

const flat = (s: string | null | undefined) => (s ?? "").replace(/[\u00a0\u202f]/g, " ");

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

function data(more: Partial<DashboardData> = {}): DashboardData & { nyt: NytData } {
  // only the parts the blocks read; the rest of the answer is not drawn here. The month's bar holds a sum of its own (150000
  // against the pace's 123400), so a tile that read the pace or the nyt figure instead of the bar would show another one
  const rest = {
    pace: { month: "2026-11", daysInMonth: 30, current: [], expected: null, projection: null, previous: null, largest: null, payDays: [] },
    ahead: { from: "2026-11-11", to: "2026-11-24", rows: [], upcoming: [], outside: [] },
    home: { paceGap: null, pace: null },
    top: { rows: [], otherCount: 0, otherCents: 0, totalCents: 0 },
    holdings: { accounts: [], cards: [], loans: [], accountsCents: 1300000, debtCents: 60000, netCents: 1240000 },
    overview: { income: { cents: 412000, earnedCents: 398000 }, net: { since: "2026-10-11", changeCents: 34500 }, months: [{ month: "2026-11", incomeCents: 412000, spendCents: 150000, fromSavingsCents: 0, complete: false }] },
  } as unknown as DashboardData;
  return { ...rest, ...more, nyt: nytOf(true) };
}

/** The tiles as a reader sees them: label, figure, line and where each leads. */
function tilesIn(d: DashboardData & { nyt: NytData }) {
  const { container } = render(createElement(Tiles, { data: d }));
  return [...container.querySelectorAll(".home-tile")].map((a) => ({
    label: a.querySelector(".home-tile-label")?.textContent,
    figure: flat(a.querySelector(".fig")?.textContent),
    line: flat(a.querySelector(".home-tile-line")?.textContent) || null,
    href: a.getAttribute("href"),
  }));
}

describe("Yhteenveto", () => {
  it("four tiles: what is left to the payday a day, the month's spending against the usual, the month's income with its earned part, the net with its month's change, and where each leads", () => {
    const pace = { month: "2026-11", day: 11, daysInMonth: 30, spentCents: 123400, expectedCents: 100000, diffCents: 23400, lowCents: 90000, highCents: 110000, position: "above", end: null, months: 6 };
    expect(tilesIn(data({ home: { paceGap: null, pace } } as never))).toEqual([
      { label: "Käytettävissä palkkapäivään", figure: "3 100 €", line: "221 € päivässä, palkkapäivä 25.11.", href: "#/bills#ennen-palkkapaivaa" },
      { label: "Menot tässä kuussa", figure: "1 500 €", line: "234 € yli tavallisen tähän päivään", href: null },
      { label: "Tulot tässä kuussa", figure: "4 120 €", line: "Ansiotulot 3 980 €", href: null },
      { label: "Varat velkojen jälkeen", figure: "12 400 €", line: "345 € enemmän kuin 11.10.", href: "#/reports?q=saldot" },
    ]);
  });

  it("the income tile names the earned part only when it differs from the income, and a month with only unearned income or a negative adjustment shows it", () => {
    const income = (cents: number, earnedCents: number) => tilesIn(data({ overview: { income: { cents, earnedCents }, net: null, months: [] } } as never))[2]!;
    expect(income(412000, 412000).line).toBeNull();
    expect(income(150000, 0)).toMatchObject({ figure: "1 500 €", line: "Ansiotulot 0 €" });
    expect(income(380000, 398000)).toMatchObject({ figure: "3 800 €", line: "Ansiotulot 3 980 €" });
  });

  // Laskut adds up the bills and Tapahtumat's money in and out take in more than the month's figures: those two tiles lead nowhere
  it("the tile of what is left leads to Laskut and the tiles of spending and income are plain", () => {
    const { container } = render(createElement(Tiles, { data: data() }));
    expect(container.querySelector("[data-tile=left] a")?.getAttribute("href")).toBe("#/bills#ennen-palkkapaivaa");
    expect(container.querySelectorAll("[data-tile=spent] a, [data-tile=income] a, button").length).toBe(0);
  });

  it("on the payday the tile says so, not the whole sum as a day's", () => {
    const d = data();
    const today = { ...d.nyt, left: { ...(d.nyt.left as Extract<NytData["left"], { known: true }>), days: 0, perDayCents: 310046 } };
    expect(tilesIn({ ...d, nyt: today })[0]!.line).toBe("Palkkapäivä tänään");
  });

  // the chart's words said it of a shorter month before; the tile said "to the same day" of the whole month
  it("after a shorter month the spending tile names last month's sum as the whole month's", () => {
    const curve = Array.from({ length: 30 }, () => 300000);
    const d = data({ pace: { ...data().pace, month: "2026-12", previous: { month: "2026-11", curve, day: 30, toToday: 300000 } } } as never);
    const end = { ...d, nyt: { ...d.nyt, from: "2026-12-31", pace: { ...d.nyt.pace, day: 31 } } };
    expect(tilesIn(end)[1]!.line).toBe("Koko viime kuussa 3 000 €");
    const same = { ...d, nyt: { ...d.nyt, pace: { ...d.nyt.pace, day: 30 } } };
    expect(tilesIn(same)[1]!.line).toBe("Viime kuussa samaan päivään 3 000 €");
  });

  it("a tile without its figure says why, and one without a comparison says what it waits for", () => {
    const d = data({ home: { paceGap: "history", pace: null }, overview: { income: { cents: 0, earnedCents: 0 }, net: null, months: [] } } as never);
    const [left, spent, income, net] = tilesIn({ ...d, nyt: nytOf(false) });
    // with no sum the tile still leads to Laskut, where the bills stand
    expect(left).toMatchObject({ figure: "–", line: "Palkkapäivä ei vielä tiedossa", href: "#/bills#ennen-palkkapaivaa" });
    expect(spent!.line).toBe("Vertailu näkyy, kun takana on kolme päättynyttä kuukautta");
    expect(income!.line).toBeNull();
    expect(net!.line).toBeNull();
    // no net at all: a balance is missing, and the tile says so
    const none = data({ holdings: { ...data().holdings, netCents: null }, overview: { ...data().overview, net: null } } as never);
    expect(tilesIn(none)[3]).toMatchObject({ figure: "–", line: "Saldo puuttuu" });
  });

  // 1.0.0 showed the sum left as a plain figure when the bills took more than the balance
  it("less left than the bills take is the tile's problem colour", () => {
    const d = data();
    const { container } = render(createElement(Tiles, { data: { ...d, nyt: nytOf(true, 600000) } }));
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
    const { container } = render(createElement(Tiles, { data: { ...data(), nyt: nytOf(true, 0, 42182, 123456) } }));
    expect(container.textContent).not.toMatch(/Palkkapäivänä lähtee/);
  });
});
