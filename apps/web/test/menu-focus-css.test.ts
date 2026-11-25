import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hex as HEX, size as SIZE } from "../src/design/tokens.ts";
import { ratioOf, rules } from "./css-kit.ts";

// A menu row under the keyboard must show more than the hover ground: a mark at 3 to 1 against the popup's surface
// (WCAG 1.4.11) that the pointer's row does not wear.

const read = (name: string): string => readFileSync(new URL(`../src/styles/${name}`, import.meta.url), "utf8");

/** The value a rule's body gives a property, or undefined. */
const value = (body: string, property: string): string | undefined =>
  body.split(";").map((d) => d.split(":")).find((d) => d[0]!.trim() === property)?.slice(1).join(":").trim();

/** A width as written, with the token `--ring` read as its px value (rule 40: a stylesheet reads the token, not 2px). */
const px = (written: string): string => written.replace(/calc\(var\(--ring\) \* -1\)/g, `-${SIZE.ring}px`).replace(/var\(--ring\)/g, `${SIZE.ring}px`);

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
      const m = /^(\d+)px solid var\(--accent\)$/.exec(px(value(drawn[0]!.body, "outline")!));
      expect(m).not.toBeNull();
      expect(Number(m![1])).toBeGreaterThanOrEqual(2);
    });

    it(`${row.file}: the outline sits inside the row, where the popup does not clip it`, () => {
      expect(px(value(drawn[0]!.body, "outline-offset")!)).toMatch(/^-\d+px$/);
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

  it("the header's user button is the name and a chevron: no initials plate is styled", () => {
    const shell = rules(read("shell.css"));
    expect(read("shell.css")).not.toContain(".avatar");
    expect(shell.find((r) => r.selector.trim() === ".user-menu summary .user-name")?.body).toContain("text-overflow: ellipsis");
  });

  it("the header's review count is outlined in the band's text colour, with no fill", () => {
    const count = rules(read("shell.css")).find((r) => r.selector.trim() === ".nav-count")!.body;
    expect(value(count, "border")).toBe("1px solid var(--on-ink)");
    expect(value(count, "background")).toBeUndefined();
  });

  it("the focus rings of the band are light on the band and accent inside the menu", () => {
    const shell = rules(read("shell.css"));
    const ring = (selector: string) => value(shell.find((r) => r.selector.trim() === selector)!.body, "outline-color");
    expect(ring(".topbar :focus-visible, .nav :focus-visible")).toBe("var(--on-ink)");
    expect(ring(".topbar .menu :focus-visible")).toBe("var(--accent)");
  });

  it("the `--row-hover` of tokens.css is still the accent at 6 %", () => {
    const accent = /--accent:\s*oklch\(([^)]+)\)/.exec(read("tokens.css"))![1]!;
    expect(read("tokens.css")).toContain(`--row-hover: oklch(${accent} / 0.06);`);
  });
});
