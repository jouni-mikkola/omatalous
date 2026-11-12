/**
 * Kuukausi on Yhteenveto is the sentence and the chart. The days as a table repeated the chart and are on the month's
 * report; a key of one line named what the heading names; a second event under the axis crowded the pay day.
 */
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { MonthPace } from "../src/components/home/MonthPace.tsx";
import type { DashboardData } from "../src/types.ts";

const DAYS = 30;
const curve = (k: number) => Array.from({ length: DAYS }, (_, i) => (i + 1) * k);

function data(pace: Partial<DashboardData["pace"]> = {}, home: Partial<DashboardData["home"]> = {}) {
  return {
    pace: { month: "2026-11", daysInMonth: DAYS, current: Array.from({ length: DAYS }, (_, i) => (i < 13 ? (i + 1) * 15_000 : null)), expected: null, projection: null, previous: null, payDays: [3, 10], ...pace },
    ahead: null,
    home: { paceGap: "cards", pace: null, ...home },
    nyt: { from: "2026-11-13", left: { known: false, reason: "no-payday", found: 0 }, usualPerDayCents: null, pace: { day: 13, spentCents: 195_000, usual: null } },
  } as unknown as DashboardData & { nyt: NonNullable<DashboardData["nyt"]> };
}

describe("Kuukausi on Yhteenveto", () => {
  afterEach(cleanup);

  it("is the chart with no table of its days, and the link to the month's days and categories stays", () => {
    const { container } = render(createElement(MonthPace, { data: data() }));
    expect(container.querySelector(".pace-chart svg")).not.toBeNull();
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector(".home-more a")?.textContent).toBe("Kuukauden päivät ja kategoriat");
  });

  it("draws no key for its one line, and one when a second series is drawn", () => {
    expect(render(createElement(MonthPace, { data: data() })).container.querySelector(".pace-key")).toBeNull();
    cleanup();
    const usual = { curve: curve(14_000), low: curve(12_000), high: curve(16_000), months: 6, toToday: 182_000, diffCents: 13_000 };
    const keyed = render(createElement(MonthPace, { data: data({ expected: usual } as never) })).container.querySelectorAll(".pace-key li");
    expect([...keyed].map((li) => li.textContent)).toEqual(["Marraskuu", "Tavallisen kuukauden vaihtelu"]);
  });

  it("marks one event under the axis: the latest pay day of the month", () => {
    const { container } = render(createElement(MonthPace, { data: data() }));
    expect([...container.querySelectorAll("text.kit-event-label")].map((e) => e.textContent)).toEqual(["Palkka 10."]);
  });

  it("marks the coming pay day instead when it falls in this month", () => {
    const ahead = { payday: { date: "2026-11-25" } };
    const { container } = render(createElement(MonthPace, { data: { ...data(), ahead } as never }));
    expect([...container.querySelectorAll("text.kit-event-label")].map((e) => e.textContent)).toEqual(["Palkka 25."]);
  });
});
