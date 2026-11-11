import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hex as HEX } from "../src/design/tokens.ts";
import { ratioOf, rules } from "./css-kit.ts";

// A menu row under the keyboard must show more than the hover ground: a mark at 3 to 1 against the popup's surface
// (WCAG 1.4.11) that the pointer's row does not wear.

const read = (name: string): string => readFileSync(new URL(`../src/styles/${name}`, import.meta.url), "utf8");

/** The value a rule's body gives a property, or undefined. */
const value = (body: string, property: string): string | undefined =>
  body.split(";").map((d) => d.split(":")).find((d) => d[0]!.trim() === property)?.slice(1).join(":").trim();

/**
 * `--row-hover` is the accent at 6 % on the surface (tokens.css). A see-through colour is laid on its ground in the
 * screen's own sRGB values, whatever space the colour is written in, so the mix is taken channel by channel.
 */
const ROW_HOVER = `#${[1, 3, 5].map((i) => Math.round(parseInt(HEX.accent.slice(i, i + 2), 16) * 0.06 + parseInt(HEX.surface.slice(i, i + 2), 16) * 0.94).toString(16).padStart(2, "0")).join("")}`;

const ROWS = [
  { file: "toolbar.css", row: ".rtb-item", focus: ".rtb-item[data-focus-visible]", ground: HEX["control-hover"] as string },
  { file: "transactions.css", row: ".tx-acctlist li", focus: ".tx-acctlist li:focus-visible", ground: ROW_HOVER },
];

describe("a menu row's focus", () => {
  for (const row of ROWS) {
    // every rule of the row that draws an outline (`0` and `none` draw nothing)
    const drawn = rules(read(row.file)).filter((r) => r.selector.split(",").some((s) => s.trim().startsWith(row.row)) && !/^(0|none)?$/.test(value(r.body, "outline") ?? ""));

    it(`${row.file}: the focused row wears an accent outline of 2 px or more`, () => {
      expect(drawn.map((r) => r.selector)).toContain(row.focus);
      const m = /^(\d+)px solid var\(--accent\)$/.exec(value(drawn[0]!.body, "outline")!);
      expect(m).not.toBeNull();
      expect(Number(m![1])).toBeGreaterThanOrEqual(2);
    });

    it(`${row.file}: the outline sits inside the row, where the popup does not clip it`, () => {
      expect(value(drawn[0]!.body, "outline-offset")).toMatch(/^-\d+px$/);
    });

    it(`${row.file}: hover alone does not show the mark: no other state of the row draws an outline`, () => {
      expect(drawn.map((r) => r.selector)).toEqual([row.focus]);
    });

    it(`${row.file}: the hover ground alone is under 3 to 1, and the mark is at 3 to 1 on the surface and on that ground`, () => {
      expect(ratioOf(row.ground, HEX.surface)).toBeLessThan(3);
      expect(ratioOf(HEX.accent, HEX.surface)).toBeGreaterThanOrEqual(3);
      expect(ratioOf(HEX.accent, row.ground)).toBeGreaterThanOrEqual(3);
    });
  }

  it("the `--row-hover` of tokens.css is still the accent at 6 %", () => {
    const accent = /--accent:\s*oklch\(([^)]+)\)/.exec(read("tokens.css"))![1]!;
    expect(read("tokens.css")).toContain(`--row-hover: oklch(${accent} / 0.06);`);
  });
});
