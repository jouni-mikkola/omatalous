/** Yhteenveto's blocks: the sum row that makes the answer, the month's line, the open questions, the categories and the figures, each opening its rows. */
import { fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Answer } from "../src/components/home/Answer.tsx";
import { Direction } from "../src/components/home/Direction.tsx";
import { MonthPace } from "../src/components/home/MonthPace.tsx";
import { Notable } from "../src/components/home/Notable.tsx";
import { notableOf } from "../src/pages/Overview.tsx";
import { Where } from "../src/components/home/Where.tsx";
import type { ReviewItem } from "../src/pages/review-items.ts";
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
  } as unknown as DashboardData;
  return { ...rest, ...more, nyt: nytOf(true) };
}

const DIRECTION = { usualCents: 322300, months: 6, recentChangeCents: 0, direction: "flat", bufferMonths: 3.8, bufferNetCents: 1230000, bufferSpendCents: 322300 } as DashboardData["home"]["direction"];

/** The window the answer is read from, with the count of checking accounts its balance adds up. */
const aheadOf = (accounts: number) => ({ from: "2026-11-11", to: "2026-11-24", balance: { accounts } }) as unknown as DashboardData["ahead"];

describe("Yhteenveto", () => {
  it("the sum row is balance, payments and what is left to the cent, the first two open their rows and what is left its basis", () => {
    const { container } = render(createElement(Answer, { nyt: nytOf(true), ahead: aheadOf(1), scope: "own" }));
    expect(flat(container.querySelector(".home-answer-line")?.textContent)).toBe("Palkkapäivään 25.11. jää 3 100 €");
    expect([...container.querySelectorAll(".home-sum-row dd")].map((e) => flat(e.textContent))).toEqual(["5 000,00 €", "−1 899,54 €", "3 100,46 €"]);
    expect([...container.querySelectorAll(".home-sum-row a")].map((a) => a.getAttribute("href"))).toEqual(["#/reports?q=saldot", "#/bills#ennen-palkkapaivaa"]);
    // what is left was a bare figure: it opens the accounts and the payments it is made of
    const door = container.querySelector(".home-sum-left button.why-door");
    expect(flat(door?.textContent)).toBe("3 100,46 €");
    expect(flat(door?.getAttribute("aria-label"))).toContain("Jää 3 100,46 €");
  });

  // the label said one account while the figure added up every counted checking account
  it("the balance names one checking account or several, as many as it adds up", () => {
    const label = (accounts: number) => render(createElement(Answer, { nyt: nytOf(true), ahead: aheadOf(accounts), scope: "own" })).container.querySelector(".home-sum-row dt")?.textContent;
    expect(label(1)).toBe("Käyttötilin saldo");
    expect(label(2)).toBe("Käyttötilien saldo");
  });

  // the payments read 0,00 € while a loan left another account before the payday, and only Laskut said so
  it("what an account outside the balance pays before the payday is a line under the sum row, opening Laskut", () => {
    const { container } = render(createElement(Answer, { nyt: nytOf(true, 0, 42182), ahead: aheadOf(1), scope: "own" }));
    expect([...container.querySelectorAll(".home-sum-row dd")].map((e) => flat(e.textContent))).toEqual(["5 000,00 €", "0,00 €", "5 000,00 €"]);
    const line = container.querySelector(".home-elsewhere a");
    expect(flat(line?.textContent)).toBe("Lisäksi 421,82 € tileiltä, joita saldo ei laske.");
    expect(line?.getAttribute("href")).toBe("#/bills#ennen-palkkapaivaa");
    expect(render(createElement(Answer, { nyt: nytOf(true, 0, 0), ahead: aheadOf(1), scope: "own" })).container.querySelector(".home-elsewhere")).toBeNull();
  });

  // the payments read 0,00 € weeks before the payday, as every bill fell on the payday itself, and nothing said why
  it("what the counted accounts pay on the payday itself is a line under the sum row, opening Laskut", () => {
    const { container } = render(createElement(Answer, { nyt: nytOf(true, 0, 0, 123456), ahead: aheadOf(1), scope: "own" }));
    expect([...container.querySelectorAll(".home-sum-row dd")].map((e) => flat(e.textContent))).toEqual(["5 000,00 €", "0,00 €", "5 000,00 €"]);
    const line = container.querySelector(".home-elsewhere a");
    expect(flat(line?.textContent)).toBe("Palkkapäivänä lähtee laskuja 1 234,56 €.");
    expect(line?.getAttribute("href")).toBe("#/bills");
  });

  // 1.0.0 printed "−0,00 €" when nothing was due before the payday
  it("payments of nothing have no minus sign", () => {
    const { container } = render(createElement(Answer, { nyt: nytOf(true, 0), ahead: aheadOf(1), scope: "own" }));
    expect([...container.querySelectorAll(".home-sum-row dd")].map((e) => flat(e.textContent))).toEqual(["5 000,00 €", "0,00 €", "5 000,00 €"]);
  });

  it("without a known sum the answer says why and draws no sum row", () => {
    const { container } = render(createElement(Answer, { nyt: nytOf(false), ahead: null, scope: "own" }));
    expect(container.querySelector(".home-sum-row")).toBeNull();
    expect(container.querySelector(".home-answer-line")?.textContent).not.toBe("");
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

  // 1.0.0 said nothing needed the household while the header counted dozens of open questions
  it("Huomioitavaa names the first open questions in the queue's order and counts them all", () => {
    const item = (id: string, merchant: string, cents: number): ReviewItem => ({ kind: "payee_out", id, cents, merchant, count: 3, lastDate: "2026-11-01", picks: [] });
    const items = [item("a", "Kauppa A", 90000), item("b", "Kauppa B", 50000), item("c", "Kauppa C", 30000), item("d", "Kauppa D", 1000)];
    const { container } = render(createElement(Notable, notableOf(items)));
    expect([...container.querySelectorAll(".home-note-title")].map((e) => e.textContent)).toEqual(["Kauppa A", "Kauppa B", "Kauppa C"]);
    expect(flat(container.querySelector(".home-note-effect")?.textContent)).toContain("900,00 €");
    expect([...container.querySelectorAll("a")].every((a) => a.getAttribute("href") === "#/review")).toBe(true);
    expect(flat(container.querySelector(".home-more")?.textContent)).toBe("Kaikki 4 tarkistettavaa");
  });

  it("with no open question Huomioitavaa is not drawn", () => {
    expect(render(createElement(Notable, notableOf([]))).container.innerHTML).toBe("");
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

  it("Varat ja velat leads with what is left after the debts, and the accounts and the debts open their rows", () => {
    const holdings = { accountsCents: 1300000, debtCents: 60000, netCents: 1240000 } as DashboardData["holdings"];
    const { container } = render(createElement(Direction, { holdings, direction: DIRECTION, today: "2026-11-11", scope: "own" }));
    expect([...container.querySelectorAll(".home-row dt")].map((e) => e.textContent)).toEqual(["Varat velkojen jälkeen", "Säästö- ja käyttötilien saldo", "Velat", "Puskuri", "Tavalliset menot"]);
    expect(flat(container.querySelector(".home-row-lead dd")?.textContent)).toBe("12 400 €");
    expect([...container.querySelectorAll(".home-row dd > a")].map((a) => a.getAttribute("href"))).toEqual(["#/reports?q=saldot", "#/reports?q=velat"]);
  });

  // 1.2.0 showed the mean of twelve whole months, one-offs and all, beside the month: a second spending figure
  it("the usual spending is the expected month the buffer divides by, names its months and opens them", () => {
    const holdings = { accountsCents: 1300000, debtCents: 0, netCents: 1300000 } as DashboardData["holdings"];
    stubApi({ "GET /api/explain": { figure: "expected.spend", kind: "median", cents: 322300, lines: [], rows: [], check: { kind: "recompute", diffCents: 0 } } });
    const { container } = render(createElement(Direction, { holdings, direction: { ...DIRECTION, months: 5 }, today: "2026-11-11", scope: "own" }));
    const row = container.querySelector(".home-row:last-child")!;
    expect(row.querySelector("dt")?.textContent).toBe("Tavalliset menot");
    expect(flat(row.querySelector("small")?.textContent)).toBe("Viime 5 kuukauden keskiarvo ilman kertaostoja. Kolmen viime kuukauden menot ovat ennallaan.");
    // the row's figure and the buffer's divisor are one number
    expect(flat(row.querySelector("button.why-door")?.textContent)).toBe("3 223 €");
    expect(flat(container.textContent)).toContain("jaettuna tavallisilla menoilla 3 223 €/kk");
    const door = row.querySelector<HTMLButtonElement>("button.why-door");
    expect(flat(door?.getAttribute("aria-label"))).toBe("Näytä tapahtumat: Tavalliset menot 3 223 €");
    fireEvent.click(door!);
    expect(flat(document.querySelector(".why-period")?.textContent)).toBe("1.–30.11.");
  });

  // 1.0.0 took a loan with no saved balance for no debt, so the net figure was too large
  it("a loan without a saved balance takes the net figure away and is named with the way to save it", () => {
    const holdings = { accountsCents: 1300000, debtCents: 60000, netCents: 1240000, unsavedLoans: { count: 1, names: ["Rahoitus Oy"], paymentCents: 28900 } } as DashboardData["holdings"];
    const { container } = render(createElement(Direction, { holdings, direction: DIRECTION, today: "2026-11-11", scope: "own" }));
    expect(container.querySelector(".home-row-lead")).toBeNull();
    // the label says the sum lacks the loan, not only the small print
    expect([...container.querySelectorAll(".home-row dt")].map((e) => e.textContent)).toContain("Velat ilman yhden lainan saldoa");
    expect(container.querySelector(".home-rows")?.textContent).toContain("Saldo puuttuu: Rahoitus Oy.");
    expect(container.querySelector(".home-row small a")?.getAttribute("href")).toBe("#/review");
  });

  it("the debts' label counts the loans its sum lacks", () => {
    const holdings = { accountsCents: 1300000, debtCents: 27800, netCents: 1272200, unsavedLoans: { count: 3, names: ["Laina A", "Laina B", "Laina C"], paymentCents: 60000 } } as DashboardData["holdings"];
    const { container } = render(createElement(Direction, { holdings, direction: DIRECTION, today: "2026-11-11", scope: "own" }));
    expect([...container.querySelectorAll(".home-row dt")].map((e) => e.textContent)).toEqual(["Säästö- ja käyttötilien saldo", "Velat ilman 3 lainan saldoa", "Puskuri", "Tavalliset menot"]);
    expect(flat(container.querySelector(".home-row small")?.textContent)).toBe("Saldo puuttuu: Laina A, Laina B, Laina C. Lisää saldo");
  });
});
