/**
 * The chart kit (charts/kit): scales, ticks, the frame, the readout, event lanes, paths and the decimation that keeps a
 * long series inside a frame's time.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { valueAxis } from "../src/charts/scale.ts";
import { band, dayNumber, isoDay, linear, monthStarts, points, time } from "../src/charts/kit/scale.ts";
import { dayTicks, moneyAxis, monthTicks, weekday } from "../src/charts/kit/ticks.ts";
import { axisRoom, frame, tickTarget } from "../src/charts/kit/layout.ts";
import { boxPlace, gridStep, nearestIndex, readoutText, stepIndex } from "../src/charts/kit/readout.ts";
import { bandRect, placeMarkers, referenceY, spreadLabels } from "../src/charts/kit/annotate.ts";
import { areaPath, linePath, stepPath } from "../src/charts/kit/path.ts";
import { decimate } from "../src/charts/kit/decimate.ts";
import { LiveReadout, ReadoutLayer } from "../src/charts/kit/Readout.tsx";
import { EventMarkers, ReferenceLine } from "../src/charts/kit/Annotations.tsx";
import { LABEL_CHAR_W, LABEL_GAP } from "../src/charts/draw.ts";
import { bestOfSync } from "../../../tools/lib/timing.ts";

describe("the linear scale", () => {
  it("keeps the ticks of the line charts' value axis when it holds zero", () => {
    for (const vals of [[0, 40_000, 123_400], [-74_400, 3_200, 42_900], [-500, -300, -100], [0], [1]]) {
      const s = linear(vals, [200, 0]);
      const old = valueAxis(vals);
      expect(s.ticks).toEqual(old.ticks);
      for (const v of vals) expect(s(v)).toBeCloseTo(200 - old.at(v) * 200, 9);
    }
  });

  it("hugs the values on round steps without zero", () => {
    const s = linear([1_012_000, 1_187_500], [100, 0], { zero: false });
    expect(s.ticks[0]).toBeLessThanOrEqual(1_012_000);
    expect(s.ticks.at(-1)).toBeGreaterThanOrEqual(1_187_500);
    expect(s.ticks[0]).toBeGreaterThan(0);
    expect(s(s.domain[0])).toBe(100);
    expect(s(s.domain[1])).toBe(0);
  });

  it("inverts a pixel back to its value", () => {
    const s = linear([0, 1000], [100, 0]);
    expect(s.invert(s(370))).toBeCloseTo(370, 9);
  });

  it("never prints a negative zero and never makes more than twelve ticks", () => {
    const s = linear([-0.4, 0.2], [1, 0]);
    expect(s.ticks.some((t) => Object.is(t, -0))).toBe(false);
    expect(linear([-1e12, 1e12], [1, 0], { target: 50 }).ticks.length).toBeLessThanOrEqual(12);
  });
});

describe("bands, points and calendar days", () => {
  it("centres a mark in its slot and finds the slot under a pixel", () => {
    const b = band(12, 600);
    expect(b.step).toBe(50);
    expect(b.x(0) + b.width / 2).toBeCloseTo(b.centre(0), 9);
    expect(b.index(-5)).toBe(0);
    expect(b.index(599)).toBe(11);
    expect(b.index(9999)).toBe(11);
  });

  it("spreads points from edge to edge, one in the middle", () => {
    expect(points(3, 100)(2)).toBe(100);
    expect(points(1, 100)(0)).toBe(50);
  });

  it("counts days by the calendar, over a leap day and a year end", () => {
    expect(dayNumber("2024-03-01") - dayNumber("2024-02-28")).toBe(2);
    expect(isoDay(dayNumber("2026-12-31") + 1)).toBe("2027-01-01");
    const t = time("2026-01-01", "2026-01-31", 300);
    expect(t.days).toBe(31);
    expect(t.x("2026-01-31")).toBe(300);
    expect(t.day(151)).toBe("2026-01-16");
    expect(t.day(-40)).toBe("2026-01-01");
  });

  it("lists the month starts an axis crosses", () => {
    expect(monthStarts("2025-11-15", "2026-02-01")).toEqual(["2025-12-01", "2026-01-01", "2026-02-01"]);
    expect(monthStarts("2026-03-01", "2026-03-31")).toEqual(["2026-03-01"]);
  });
});

describe("Finnish ticks", () => {
  it("writes money with the minus the app prints", () => {
    expect(moneyAxis(-150_000)).toBe(`−${moneyAxis(150_000)}`);
    expect(moneyAxis(150_000)).toMatch(/^1\s500\s€$/);
  });

  it("starts the week on Monday", () => {
    expect(weekday("2026-10-19")).toBe(0);
    expect(weekday("2026-10-25")).toBe(6);
  });

  it("prints every month with its January's year when there is room, and thins them when there is not", () => {
    const months = ["2025-11", "2025-12", "2026-01", "2026-02"];
    const wide = monthTicks(months, 80);
    expect(wide.every((m) => m.printed)).toBe(true);
    expect(wide[2]).toMatchObject({ text: "tammi", year: "2026" });
    const narrow = monthTicks(months, 20, new Set([3]));
    expect(narrow[3]!.printed).toBe(true);
    expect(narrow.filter((m) => m.printed).length).toBeLessThan(4);
    expect(narrow.every((m) => m.year === null)).toBe(true);
  });

  it("labels the days of a month like the pace chart", () => {
    expect(dayTicks(31)).toEqual([1, 5, 10, 15, 20, 25, 31]);
    expect(dayTicks(26)).toEqual([1, 5, 10, 15, 20, 26]);
  });
});

describe("the frame", () => {
  it("grows with the width between its heights", () => {
    const m = { top: 12, right: 16, bottom: 24, left: 64 };
    expect(frame(390, m).height).toBe(240);
    expect(frame(1200, m).height).toBe(264);
    expect(frame(3000, m).height).toBe(320);
    expect(frame(390, m, { extraBottom: 12 }).innerH).toBe(240 - 36 - 12);
    expect(frame(10, m).innerW).toBe(0);
  });

  it("makes room for the longest axis label and fewer ticks on a short plot", () => {
    expect(axisRoom(["0 €", "−12 500 €"])).toBe(Math.ceil(9 * LABEL_CHAR_W + 14));
    expect(axisRoom([])).toBe(40);
    expect(tickTarget(80)).toBe(2);
    expect(tickTarget(220)).toBe(4);
    expect(tickTarget(900)).toBe(5);
  });
});

describe("the readout", () => {
  const xs = Array.from({ length: 2000 }, (_, i) => i * 0.5);

  it("finds the nearest datum to a pixel", () => {
    expect(nearestIndex(xs, -10)).toBe(0);
    expect(nearestIndex(xs, 10.2)).toBe(20);
    expect(nearestIndex(xs, 10.3)).toBe(21);
    expect(nearestIndex(xs, 5000)).toBe(1999);
    expect(nearestIndex([], 3)).toBe(-1);
  });

  it("moves with the keys and leaves other keys to the page", () => {
    expect(stepIndex("ArrowRight", null, 10)).toBe(0);
    expect(stepIndex("ArrowLeft", null, 10)).toBe(9);
    expect(stepIndex("ArrowRight", 9, 10)).toBe(9);
    expect(stepIndex("PageDown", 3, 10)).toBe(0);
    expect(stepIndex("End", 0, 10)).toBe(9);
    expect(stepIndex("Escape", 4, 10)).toBeNull();
    expect(stepIndex("Tab", 4, 10)).toBeUndefined();
    expect(stepIndex("ArrowRight", null, 0)).toBeUndefined();
  });

  it("puts the box on the side with room, never off the left", () => {
    expect(boxPlace(100, 800)).toEqual({ left: 112 });
    expect(boxPlace(700, 800)).toEqual({ right: 112 });
    expect(boxPlace(150, 300)).toEqual({ left: 110 });
  });

  it("reads one datum as a sentence", () => {
    expect(readoutText("loka 2026", [{ name: "Menot", value: "12 €" }, { name: "Tulot", value: "30 €" }])).toBe("loka 2026: Menot 12 €, Tulot 30 €");
    expect(readoutText("loka 2026", [])).toBe("loka 2026");
  });

  it("draws one focusable layer with a crosshair at the datum", () => {
    const html = renderToStaticMarkup(createElement("svg", null, createElement(ReadoutLayer, { xs: [0, 50, 100], innerW: 100, innerH: 80, at: 1, onAt: () => {}, label: "Saldo" })));
    expect(html).toContain('aria-label="Saldo"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('x1="50.5"');
    const live = renderToStaticMarkup(createElement(LiveReadout, { text: "loka: 12 €" }));
    expect(live).toContain('aria-live="polite"');
  });
});

describe("annotations", () => {
  it("lays event labels into lanes so no two touch", () => {
    const markers = [0, 10, 20, 30, 300].map((x, i) => ({ key: String(i), x, label: "Palkka" }));
    const placed = placeMarkers(markers, 310);
    expect(placed[0]!.anchor).toBe("start");
    expect(placed[4]!.anchor).toBe("end");
    const w = 6 * LABEL_CHAR_W;
    for (const lane of [0, 1]) {
      const spans = placed
        .filter((p) => p.lane === lane)
        .map((p) => (p.anchor === "start" ? p.x : p.anchor === "end" ? p.x - w : p.x - w / 2));
      for (let i = 1; i < spans.length; i++) expect(spans[i]! - spans[i - 1]!).toBeGreaterThanOrEqual(w + LABEL_GAP);
    }
    expect(placed.some((p) => p.lane === -1)).toBe(true);
  });

  it("keeps references and bands inside the plot", () => {
    expect(referenceY(-1, 100)).toBeNull();
    expect(referenceY(40, 100)).toBe(40);
    expect(bandRect(120, 60, 100)).toEqual({ y: 60, h: 40 });
    expect(bandRect(120, 110, 100)).toBeNull();
    const html = renderToStaticMarkup(createElement("svg", null, createElement(ReferenceLine, { y: 30, innerW: 200, innerH: 100, label: "tavallinen" }), createElement(EventMarkers, { markers: placeMarkers([{ key: "a", x: 50, label: "Palkka" }], 200), innerH: 100, base: 100 })));
    expect(html).toContain("tavallinen");
    expect(html).toContain("Palkka");
    expect(renderToStaticMarkup(createElement(ReferenceLine, { y: 300, innerW: 200, innerH: 100 }))).toBe("");
  });
});

const x = (i: number) => i * 10;
const y = (v: number) => 100 - v;

describe("paths", () => {

  it("lifts the pen at a gap", () => {
    expect(linePath([1, 2, null, 4], x, y)).toBe("M0.0,99.0L10.0,98.0M30.0,96.0");
  });

  it("holds a step until the next value", () => {
    expect(stepPath([5, 5, 8], x, y)).toBe("M0.0,95.0H10.0V95.0H20.0V92.0");
  });

  it("closes an area per piece between gaps", () => {
    const d = areaPath([0, 0, null, 0], [5, 6, 7, 8], x, y);
    expect(d.match(/Z/g)).toHaveLength(2);
  });
});

describe("a long series", () => {
  const values = Array.from({ length: 2000 }, (_, i) => Math.round(Math.sin(i / 30) * 10_000) + (i === 777 ? 90_000 : 0));

  it("keeps every peak at most four points a pixel column", () => {
    const keep = decimate(values, 300);
    expect(keep.length).toBeLessThanOrEqual(1200);
    expect(keep).toContain(777);
    expect(keep[0]).toBe(0);
    expect(keep.at(-1)).toBe(1999);
    expect([...keep].sort((a, b) => a - b)).toEqual(keep);
  });

  it("keeps a short series whole and a gap as a gap", () => {
    expect(decimate([1, 2, 3], 300)).toEqual([0, 1, 2]);
    const gappy: (number | null)[] = values.map((v, i) => (i >= 1000 && i < 1010 ? null : v));
    const keep = decimate(gappy, 100);
    expect(keep.some((i) => gappy[i] === null)).toBe(true);
    expect(linePath(gappy, x, y, keep).split("M").length).toBe(3);
  });

  it("scales, decimates and draws 2 000 points inside a frame (16 ms)", () => {
    const run = () => {
      const s = linear(values, [240, 0]);
      const at = points(values.length, 800);
      return linePath(values, at, s, decimate(values, 800));
    };
    // the work, which load cannot change: the path holds at most four points a pixel column of the 800
    const drawn = run().match(/[ML]/g)!.length;
    expect(drawn).toBeLessThanOrEqual(4 * 800);
    expect(drawn).toBeGreaterThan(800);
    // the time: the process's CPU time, the best of five runs after a warm-up (`bestOfSync`)
    expect(bestOfSync(5, run).ms).toBeLessThan(16);
  });
});

describe("end labels of a slope", () => {
  it("leave labels with room where their data are", () => {
    const out = spreadLabels([{ key: "a", y: 10 }, { key: "b", y: 80 }], 200);
    expect(out.map((l) => l.at)).toEqual([10, 80]);
  });

  it("spread a tight cluster around its data, in order, inside the plot", () => {
    const ys = [100, 101, 102, 103, 0, 1, 199];
    const out = spreadLabels(ys.map((y, i) => ({ key: String(i), y })), 200, 14);
    const shown = out.filter((l) => !l.hidden).sort((a, b) => a.y - b.y);
    for (let i = 1; i < shown.length; i++) expect(shown[i]!.at - shown[i - 1]!.at).toBeGreaterThanOrEqual(14 - 1e-9);
    for (const l of shown) {
      expect(l.at).toBeGreaterThanOrEqual(0);
      expect(l.at).toBeLessThanOrEqual(200);
    }
    // the cluster of four stays centred on its data
    const mid = out.filter((l) => ["0", "1", "2", "3"].includes(l.key)).map((l) => l.at);
    expect((mid[0]! + mid[3]!) / 2).toBeCloseTo(101.5, 9);
  });

  it("hide labels a side has no room for, keeping the order of the rest", () => {
    const out = spreadLabels(Array.from({ length: 10 }, (_, i) => ({ key: String(i), y: i })), 28, 14);
    expect(out.filter((l) => !l.hidden)).toHaveLength(3);
    expect(out[0]!.hidden).toBe(false);
  });
});

describe("the readout of a grid", () => {
  it("steps by cell, by four weeks, to the ends, and starts at the last cell", () => {
    expect(gridStep("ArrowRight", null, 53, 7)).toEqual({ col: 52, row: 6 });
    expect(gridStep("ArrowUp", { col: 3, row: 0 }, 53, 7)).toEqual({ col: 3, row: 0 });
    expect(gridStep("ArrowDown", { col: 3, row: 0 }, 53, 7)).toEqual({ col: 3, row: 1 });
    expect(gridStep("PageDown", { col: 50, row: 2 }, 53, 7)).toEqual({ col: 52, row: 2 });
    expect(gridStep("Home", { col: 9, row: 4 }, 53, 7)).toEqual({ col: 0, row: 0 });
    expect(gridStep("Escape", { col: 9, row: 4 }, 53, 7)).toBeNull();
    expect(gridStep("a", { col: 9, row: 4 }, 53, 7)).toBeUndefined();
  });
});
