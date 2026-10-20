/**
 * The table kit (components/table): the inline bar, the sparkline, the delta chip's tone, the avatar, the sort, the
 * groups and the row window over 500 rows, and the repo rules of the kit (no sum of its own, no table outside it).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MerchantAvatar } from "../src/components/MerchantAvatar.tsx";
import { barShare, deltaTone, groupRows, rowWindow, sparkGeometry, VIRTUAL_FROM } from "../src/components/table/cells.ts";
import { nextSort, sortBy, sortMessage, sortRows } from "../src/components/table/sort.ts";
import { BarCell, DeltaChip, MarkCell, SortHead, SparkCell } from "../src/components/table/Cells.tsx";

describe("an inline bar", () => {
  it("fills its share of the column's scale, 0 to 1", () => {
    expect(barShare(50, 200)).toBe(0.25);
    expect(barShare(-50, 200)).toBe(0.25);
    expect(barShare(500, 200)).toBe(1);
    expect(barShare(5, 0)).toBe(0);
    expect(renderToStaticMarkup(createElement(BarCell, { value: 1, max: 3 }))).toContain("width:33.3%");
  });
});

describe("a sparkline", () => {
  it("ends in a dot at the last value and draws the usual level inside its box", () => {
    const g = sparkGeometry([10, null, 30, 20], 72, 22, 25);
    expect(g.d.split("M")).toHaveLength(3);
    expect(g.dot!.x).toBeCloseTo(70, 9);
    expect(g.usualY).toBeGreaterThan(2);
    expect(g.usualY).toBeLessThan(20);
    expect(sparkGeometry([null], 72, 22).dot).toBeNull();
    expect(sparkGeometry([5, 5], 72, 22).dot!.y).toBe(11);
    // on the table's shared scale a small row stays low and a flat one is no longer drawn at mid height
    expect(sparkGeometry([5, 5], 72, 22, null, { lo: 0, hi: 100 }).dot!.y).toBeCloseTo(19.1, 9);
    expect(sparkGeometry([100], 72, 22, null, { lo: 0, hi: 100 }).dot!.y).toBe(2);
    const html = renderToStaticMarkup(
      createElement(SparkCell, {
        values: [1, 2, 3],
        usual: 2,
        label: "12 kuukautta",
      }),
    );
    expect(html).toContain('aria-label="12 kuukautta"');
    expect(html).toContain("rt-spark-usual");
  });
});

describe("a delta chip", () => {
  it("takes its tone from the meaning, never the sign alone", () => {
    expect(deltaTone(500, "spend")).toBe("bad");
    expect(deltaTone(-500, "spend")).toBe("good");
    expect(deltaTone(500, "gain")).toBe("good");
    expect(deltaTone(-500, "gain")).toBe("bad");
    expect(deltaTone(500, "neutral")).toBe("flat");
    expect(deltaTone(50, "spend", 100)).toBe("flat");
  });

  it("carries an arrow so the colour is not alone", () => {
    const html = renderToStaticMarkup(
      createElement(DeltaChip, {
        delta: 1200,
        text: "+12 €",
        meaning: "spend",
      }),
    );
    expect(html).toContain("rt-delta-bad");
    expect(html).toContain("↑");
    expect(renderToStaticMarkup(createElement(DeltaChip, { delta: 0, text: "±0 €", meaning: "spend" }))).toContain("→");
  });
});

describe("a payee's avatar", () => {
  it("gives a name the same series whatever its case or accents, and two letters of its first words", () => {
    const html = (name: string) => renderToStaticMarkup(createElement(MerchantAvatar, { name }));
    expect(html("K-Market")).toMatch(/data-tint="[1-7]"/);
    expect(html("K-Market")).toBe(html("K-MARKET"));
    expect(html("K-Market")).toContain(">KM<");
    expect(html("Lidl")).toContain(">LI<");
    expect(html("  ")).toContain(">?<");
  });
});

describe("a payee's mark", () => {
  it("gives a person a glyph, never initials", () => {
    const html = renderToStaticMarkup(createElement(MarkCell, { name: "Matti Meikäläinen", person: true }));
    expect(html).not.toContain(">MM<");
    expect(html).not.toContain("data-tint");
    expect(html).toContain("<svg");
  });
});

describe("sorting", () => {
  const rows = [
    { name: "Öljy", cents: 300 },
    { name: "Auto", cents: null },
    { name: "Zeta", cents: 100 },
    { name: "Bensa", cents: 300 },
  ];

  it("is stable and puts an empty value last both ways", () => {
    expect(sortRows(rows, (r) => r.cents, "descending").map((r) => r.name)).toEqual(["Öljy", "Bensa", "Zeta", "Auto"]);
    expect(sortRows(rows, (r) => r.cents, "ascending").map((r) => r.name)).toEqual(["Zeta", "Öljy", "Bensa", "Auto"]);
  });

  it("sorts text the Finnish way", () => {
    expect(sortRows(rows, (r) => r.name, "ascending").map((r) => r.name)).toEqual(["Auto", "Bensa", "Zeta", "Öljy"]);
  });

  it("marks the sorted column for readers and has aria-sort before a press", () => {
    const head = (dir: "ascending" | "descending" | null) =>
      renderToStaticMarkup(
        createElement(
          "tr",
          null,
          createElement(SortHead, {
            label: "Summa",
            dir,
            numeric: true,
            onSort: () => {},
          }),
        ),
      );
    expect(head("descending")).toContain('aria-sort="descending"');
    expect(head("descending")).toContain('class="num"');
    expect(head(null)).toContain('aria-sort="none"');
  });

  it("goes through three states a press: the first direction, the other, the server's order; a name starts from A", () => {
    const text = ["name"];
    expect(nextSort(null, "sum", text)).toEqual({
      key: "sum",
      dir: "descending",
    });
    expect(nextSort({ key: "sum", dir: "descending" }, "sum", text)).toEqual({
      key: "sum",
      dir: "ascending",
    });
    expect(nextSort({ key: "sum", dir: "ascending" }, "sum", text)).toBeNull();
    expect(nextSort(null, "name", text)).toEqual({
      key: "name",
      dir: "ascending",
    });
    expect(nextSort({ key: "name", dir: "ascending" }, "name", text)).toEqual({
      key: "name",
      dir: "descending",
    });
    expect(nextSort({ key: "name", dir: "descending" }, "name", text)).toBeNull();
    expect(nextSort({ key: "sum", dir: "ascending" }, "name", text)).toEqual({
      key: "name",
      dir: "ascending",
    });
  });

  it("keeps the server's order without a sort and says each state to a screen reader", () => {
    const list = [{ v: 2 }, { v: 3 }];
    expect(sortBy(list, null, (r) => r.v)).toBe(list);
    expect(sortBy(list, { key: "v", dir: "descending" }, (r) => r.v).map((r) => r.v)).toEqual([3, 2]);
    expect(sortMessage("Summa", "descending", false)).toBe("Järjestetty: Summa, suurin ensin");
    expect(sortMessage("Summa", "ascending", false)).toBe("Järjestetty: Summa, pienin ensin");
    expect(sortMessage("Saaja", "ascending", true)).toBe("Järjestetty: Saaja, aakkosjärjestys");
    expect(sortMessage("Summa", null, false)).toBe("Alkuperäinen järjestys");
  });
});

describe("groups and the row window", () => {
  it("groups in the order the groups first appear", () => {
    const g = groupRows(["a1", "b1", "a2"], (s) => s[0]!);
    expect(g).toEqual([
      { key: "a", rows: ["a1", "a2"] },
      { key: "b", rows: ["b1"] },
    ]);
  });

  it("draws every row under 500 and a window over it with the scroll length kept", () => {
    expect(rowWindow(VIRTUAL_FROM - 1, 32, 5000, 600)).toEqual({
      start: 0,
      end: VIRTUAL_FROM - 1,
      padTop: 0,
      padBottom: 0,
    });
    const w = rowWindow(2000, 32, 3200, 640);
    expect(w.start).toBe(92);
    expect(w.end).toBe(128);
    expect(w.padTop + (w.end - w.start) * 32 + w.padBottom).toBe(2000 * 32);
    expect(rowWindow(2000, 32, 1e9, 640).end).toBe(2000);
  });
});

const HAND_MADE_FILES = [
  "charts/forms/IncomeUse.tsx",
  "pages/reports/sections/Categories.tsx",
  "pages/reports/sections/CategoryShift.tsx",
];

describe("the kit's rules", () => {
  const src = join(__dirname, "../src");
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
  const all = files(src).filter((f) => /\.tsx?$/.test(f));

  it("adds nothing up: no sum over row values in DataTable, ChartTable and the sort", () => {
    for (const f of all.filter((x) => /components\/table\/(DataTable|ChartTable|sort)\./.test(x))) {
      const text = readFileSync(f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(text, relative(src, f)).not.toMatch(/\.reduce\(|\+=/);
    }
  });

  // The allowlist only shrinks: a wave that moves a page onto DataTable takes its line out.
  const HAND_MADE = new Set<string>(HAND_MADE_FILES);
  it("has no hand-made table outside the kit and the allowlist, and the allowlist holds no file without one", () => {
    const withTable = all
      .filter((f) => !f.includes("/components/table/") && !f.includes("/private/") && /<table[\s>]/.test(readFileSync(f, "utf8")))
      .map((f) => relative(src, f))
      .sort();
    expect(withTable.filter((f) => !HAND_MADE.has(f))).toEqual([]);
    expect([...HAND_MADE].filter((f) => !withTable.includes(f)).sort()).toEqual([]);
  });
});
