import { describe, expect, it } from "vitest";
import { areasOf, domTestsPassed, loweredAreas } from "./coverage.mjs";

const areas = { pages: { path: "apps/web/src/pages/", lines: 55 }, App: { path: "apps/web/src/App.tsx", lines: 70 } };
const floor = { areas, domTests: 40 };

describe("loweredAreas", () => {
  it("names an area whose floor is under the one on main, or gone", () => {
    expect(loweredAreas({ areas: { pages: { ...areas.pages, lines: 50 } }, domTests: 39 }, floor)).toEqual(["pages: 50 is under 55 on main", "App: removed", "domTests: 39 is under 40 on main"]);
  });

  it("accepts an equal or higher floor and a branch with no main to compare", () => {
    expect(loweredAreas({ domTests: 41, areas: { ...areas, pages: { ...areas.pages, lines: 56 } } }, floor)).toEqual([]);
    expect(loweredAreas(floor, null)).toEqual([]);
  });
});

describe("a floor that measures other files", () => {
  it("is refused: an area moved to a file that is fully covered would pass", () => {
    const moved = { ...floor, areas: { ...areas, pages: { path: "apps/web/src/pages/Auth.tsx", lines: 55 } } };
    expect(loweredAreas(moved, floor)).toEqual(["pages: the path apps/web/src/pages/Auth.tsx is not apps/web/src/pages/ of main"]);
  });
});

describe("domTestsPassed", () => {
  it("counts the passed tests of the dom files only", () => {
    const ok = { status: "passed" };
    const report = { testResults: [{ name: "/r/a.dom.test.ts", assertionResults: [ok, ok, { status: "failed" }] }, { name: "/r/b.test.ts", assertionResults: [ok] }] };
    expect(domTestsPassed(report)).toBe(2);
  });
});

describe("areasOf", () => {
  it("adds up the lines of the files under an area's path, and counts a file nobody loads", () => {
    const at = (f: string, total: number, covered: number) => [`${process.cwd()}/${f}`, { lines: { total, covered } }];
    const summary = Object.fromEntries([at("apps/web/src/pages/A.tsx", 10, 10), at("apps/web/src/pages/B.tsx", 30, 0), at("apps/web/src/App.tsx", 20, 10)]);
    const out = areasOf(areas, summary);
    expect(out.pages).toMatchObject({ total: 40, covered: 10, pct: 25 });
    expect(out.App).toMatchObject({ total: 20, covered: 10, pct: 50 });
  });
});
