/**
 * The week sums and the weekday averages of the calendar (CalendarHeat) read out as its days do: the arrow keys reach
 * them from the edge of the days and come back, a tapped bar keeps its readout, and a mouse that leaves clears it.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CalendarHeat } from "../src/charts/CalendarHeat.tsx";
import { money, setLanguage } from "../src/format.ts";

/** Three whole weeks from Monday 5.10.2026, a sum for each, and an average for each weekday but Sunday. */
const days = Array.from({ length: 21 }, (_, i) => ({ date: `2026-10-${String(5 + i).padStart(2, "0")}`, cents: 1000 + i * 100, count: 1 + (i % 3) }));
const weeks = [
  { from: "2026-10-05", cents: 10_000 },
  { from: "2026-10-12", cents: 25_000 },
  { from: "2026-10-19", cents: 5_000 },
];
const weekdayAvgCents = [1000, 2000, 3000, 4000, 5000, 6000, null];
const QUESTION = "Minä päivinä rahaa menee?";

/** The DOM of the tests lays nothing out: the chart measures a desktop's width, so it draws every week. */
const measured = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
beforeAll(() => Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 900 }));
afterAll(() => {
  if (measured) Object.defineProperty(HTMLElement.prototype, "clientWidth", measured);
  else delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
});
afterEach(() => {
  cleanup();
  setLanguage("fi");
});

function draw(sums: { weeks?: typeof weeks; weekdayAvgCents?: typeof weekdayAvgCents } = { weeks, weekdayAvgCents }) {
  const { container } = render(createElement(CalendarHeat, { days, today: "2026-10-25", question: QUESTION, ...sums }));
  const grid = container.querySelector<SVGGElement>(".calendar-grid")!;
  return {
    container,
    grid,
    key: (key: string) => fireEvent.keyDown(grid, { key }),
    /** The sentence a screen reader hears. */
    said: () => container.querySelector("[aria-live]")!.textContent!,
    /** The title of the readout box, or null when none is shown. */
    shown: () => container.querySelector(".tooltip-title")?.textContent ?? null,
    weekBars: () => [...container.querySelectorAll<SVGRectElement>(".calendar-week .calendar-week-hit")],
    meanBars: () => [...container.querySelectorAll<SVGRectElement>(".calendar-mean .calendar-week-hit")],
    /** Which stop is marked: "day", "week 1", "mean 6" or "" for none. */
    active: () =>
      [
        container.querySelector(".calendar-day.active") ? "day" : "",
        ...[...container.querySelectorAll(".calendar-week")].map((g, i) => (g.classList.contains("active") ? `week ${i}` : "")),
        ...[...container.querySelectorAll(".calendar-mean")].map((g, i) => (g.classList.contains("active") ? `mean ${i}` : "")),
      ]
        .filter(Boolean)
        .join(" "),
  };
}

describe("the sums of the calendar by keyboard", () => {
  it("goes down from the last row to the week's sum, walks the sums and comes back to the days", () => {
    const c = draw();
    fireEvent.focus(c.grid);
    expect(c.active()).toBe("day");
    c.key("ArrowDown");
    expect(c.active()).toBe("week 2");
    expect(c.shown()).toMatch(/^Viikko /);
    expect(c.said()).toBe(`${c.shown()}: Menot ${money(5_000, false)}`);
    c.key("ArrowLeft");
    expect(c.active()).toBe("week 1");
    expect(c.said()).toBe(`${c.shown()}: Menot ${money(25_000, false)}`);
    c.key("ArrowLeft");
    c.key("ArrowLeft");
    expect(c.active()).toBe("week 0");
    c.key("ArrowRight");
    expect(c.active()).toBe("week 1");
    c.key("ArrowDown");
    expect(c.active()).toBe("week 1");
    c.key("ArrowUp");
    expect(c.active()).toBe("day");
    // Sunday 18.10., the last row of the column the sum stands under
    expect(c.said()).toContain(`Menot ${money(1000 + 13 * 100, false)}`);
  });

  it("goes right from the last column to the weekday's average, walks the averages and comes back to the days", () => {
    const c = draw();
    fireEvent.focus(c.grid);
    c.key("ArrowRight");
    expect(c.active()).toBe("mean 6");
    // the average of a weekday with no days is said too, where only a pointer found it before
    expect(c.shown()).toBe("Sunnuntai");
    expect(c.said()).toBe("Sunnuntai: Keskimäärin ei päiviä");
    c.key("ArrowDown");
    expect(c.active()).toBe("mean 6");
    c.key("ArrowUp");
    expect(c.active()).toBe("mean 5");
    expect(c.said()).toBe(`Lauantai: Keskimäärin ${money(6000, false)}`);
    c.key("ArrowRight");
    expect(c.active()).toBe("mean 5");
    c.key("ArrowLeft");
    expect(c.active()).toBe("day");
    // Saturday 24.10., the last column of the row the average stands beside
    expect(c.said()).toContain(`Menot ${money(1000 + 19 * 100, false)}`);
    c.key("ArrowDown");
    c.key("ArrowDown");
    expect(c.active()).toBe("week 2");
    c.key("Escape");
    expect(c.active()).toBe("");
    expect(c.shown()).toBeNull();
    expect(c.said()).toBe("");
  });

  it("stays on the days when the calendar draws no sums", () => {
    const c = draw({});
    fireEvent.focus(c.grid);
    c.key("ArrowDown");
    c.key("ArrowRight");
    expect(c.active()).toBe("day");
    expect(c.said()).toContain(`Menot ${money(1000 + 20 * 100, false)}`);
  });

  it("names the sums in the group's name and the strip's label from the catalogue, in both languages", () => {
    const fi = draw();
    expect(fi.grid.getAttribute("aria-label")).toBe(`${QUESTION}. Nuolinäppäimet siirtävät päivästä toiseen. Alimmalta riviltä nuoli alas vie viikon summaan. Viimeisestä sarakkeesta nuoli oikealle vie viikonpäivän keskiarvoon.`);
    expect(fi.container.querySelector(".calendar-strip-label")!.textContent).toBe("vk");
    // a calendar with no sums promises none
    expect(draw({}).grid.getAttribute("aria-label")).toBe(`${QUESTION}. Nuolinäppäimet siirtävät päivästä toiseen.`);
    cleanup();
    setLanguage("en");
    const en = draw();
    expect(en.grid.getAttribute("aria-label")).toBe(`${QUESTION}. Arrow keys move from day to day. From the last row the down arrow goes to the sum of the week. From the last column the right arrow goes to the average of the weekday.`);
    expect(en.container.querySelector(".calendar-strip-label")!.textContent).toBe("wk");
  });
});

describe("the sums of the calendar by pointer", () => {
  it("keeps the readout of a tapped bar until the next tap or Escape", () => {
    const c = draw();
    const [, week] = c.weekBars();
    // the bars are in the group that takes the keys: a tap gives it the focus, so the tap is not lost to a blur and Escape lets go
    expect(c.grid.contains(week!)).toBe(true);
    fireEvent.pointerDown(week!, { pointerType: "touch" });
    fireEvent.focus(c.grid);
    fireEvent.pointerLeave(week!, { pointerType: "touch" });
    expect(c.active()).toBe("week 1");
    expect(c.said()).toBe(`${c.shown()}: Menot ${money(25_000, false)}`);
    const sunday = c.meanBars()[6]!;
    expect(c.grid.contains(sunday)).toBe(true);
    fireEvent.pointerDown(sunday, { pointerType: "touch" });
    fireEvent.pointerLeave(sunday, { pointerType: "touch" });
    expect(c.active()).toBe("mean 6");
    expect(c.said()).toBe("Sunnuntai: Keskimäärin ei päiviä");
    c.key("Escape");
    expect(c.active()).toBe("");
    expect(c.shown()).toBeNull();
  });

  it("clears the readout of a bar when the mouse leaves it", () => {
    const c = draw();
    for (const bar of [c.weekBars()[0]!, c.meanBars()[2]!]) {
      fireEvent.pointerEnter(bar, { pointerType: "mouse" });
      expect(c.shown()).not.toBeNull();
      expect(c.said()).not.toBe("");
      fireEvent.pointerLeave(bar, { pointerType: "mouse" });
      expect(c.active()).toBe("");
      expect(c.shown()).toBeNull();
      expect(c.said()).toBe("");
    }
  });
});
