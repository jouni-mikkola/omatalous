/**
 * The calendar of days and the slope (VC3): drawn at a measured width, so `useWidth` is fixed here. The calendar takes
 * any day series with a question and shades it by core's `dayHeat`; the slope takes its height from its strong lines,
 * its scale from them too, and names the context lines it leaves out.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

let measured = 900;
vi.mock("../src/hooks.ts", async (orig) => ({
  ...(await orig<typeof import("../src/hooks.ts")>()),
  useWidth: () => [{ current: null }, measured],
}));

const { CalendarHeat } = await import("../src/charts/CalendarHeat.tsx");
const { SlopeChart } = await import("../src/charts/SlopeChart.tsx");

const days = Array.from({ length: 28 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, cents: i % 7 === 5 ? 9000 : i % 3 ? 2000 : 0, count: i % 3 ? 1 : 0 }));
const text = (html: string) => html.replace(/[  ]/g, " ");

describe("CalendarHeat", () => {
  it("draws any day series with its question as the name, one cell a day, shaded by core when the server sent no shade", () => {
    measured = 900;
    const html = text(renderToStaticMarkup(createElement(CalendarHeat, { days, today: "2026-10-01", question: "Minä päivinä rahaa menee?" })));
    expect(html).toContain('aria-label="Minä päivinä rahaa menee?"');
    expect(html.match(/class="calendar-day /g)).toHaveLength(28);
    // the Saturdays are four and a half times the usual day: the darkest step; an empty day is plain
    expect(html.match(/calendar-day heat-4/g)).toHaveLength(4);
    expect(html).toContain("calendar-day heat-0");
    expect(html).toContain("Tavalliseen verrattuna:");
    // no strip and no weekday column without their server fields
    expect(html).not.toContain("calendar-week-bar");
    expect(html).not.toContain("ka / pv");
    // the grid takes the keyboard
    expect(html).toMatch(/class="calendar-grid" tabindex="0" role="group"/);
  });

  it("keeps the server's shade and shows the last 13 weeks on a phone", () => {
    const long = Array.from({ length: 26 * 7 }, (_, i) => ({ date: new Date(Date.UTC(2026, 3, 6 + i)).toISOString().slice(0, 10), cents: 1000, count: 1, heat: 2 }));
    measured = 358;
    const html = renderToStaticMarkup(createElement(CalendarHeat, { days: long, today: "2026-10-30", question: "Minä päivinä rahaa menee?" }));
    expect(html.match(/class="calendar-day /g)).toHaveLength(13 * 7);
    expect(html).not.toContain("heat-0");
  });

  it("lists only the top days it draws, each with its rank among all of them", () => {
    const long = Array.from({ length: 26 * 7 }, (_, i) => ({ date: new Date(Date.UTC(2026, 3, 6 + i)).toISOString().slice(0, 10), cents: 1000, count: 1, heat: 2 }));
    const top = [{ date: "2026-05-10" }, { date: "2026-09-30" }];
    const note = (d: { date: string }) => `päivä ${d.date}`;
    measured = 358;
    const phone = renderToStaticMarkup(createElement(CalendarHeat, { days: long, today: "2026-10-30", question: "q", top, topNote: note }));
    expect(phone).not.toContain("päivä 2026-05-10");
    expect(phone).toMatch(/<span class="badge-n">2<\/span>päivä 2026-09-30/);
    measured = 900;
    const wide = renderToStaticMarkup(createElement(CalendarHeat, { days: long, today: "2026-10-30", question: "q", top, topNote: note }));
    expect(wide).toMatch(/<span class="badge-n">1<\/span>päivä 2026-05-10/);
  });
});

describe("SlopeChart", () => {
  const item = (key: string, from: number, to: number, strong: boolean) => ({ key, label: key, from, to, change: to - from, strong, tone: to > from ? ("bad" as const) : ("good" as const) });

  it("takes 24 px a strong line and at least 220 px, its scale from the strong lines, and names a context line that runs off it", () => {
    measured = 900;
    const few = renderToStaticMarkup(createElement(SlopeChart, { items: [item("Kahvi", 4000, 5200, true), item("Matkat", 60_000, 20_000, true)], fromLabel: "Ennen", toLabel: "Nyt", label: "x" }));
    expect(few).toMatch(/<svg width="900" height="220"/);
    const many = Array.from({ length: 10 }, (_, i) => item(`K${i}`, 1000 * i, 1000 * i + 5000, true));
    const tall = renderToStaticMarkup(createElement(SlopeChart, { items: [...many, item("Asuminen", 900_000, 910_000, false)], fromLabel: "Ennen", toLabel: "Nyt", label: "x" }));
    expect(tall).toMatch(/<svg width="900" height="342"/);
    expect(text(tall)).toContain("Asuminen ei mahdu kuvaan. Sen luvut ovat taulukossa.");
  });

  it("writes the server's change at the right end and reads by the keyboard", () => {
    measured = 900;
    const html = text(renderToStaticMarkup(createElement(SlopeChart, { items: [{ ...item("Kahvi", 4000, 5200, true), change: 1200 }], fromLabel: "2025", toLabel: "2026", label: "x" })));
    expect(html).toContain("+12 €");
    expect(html).toMatch(/tabindex="0" role="group"/);
  });
});
