import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rules } from "./css-kit.ts";

const read = (name: string) => readFileSync(new URL(`../src/styles/${name}`, import.meta.url), "utf8");
const sheet = (name: string) => rules(read(name));

/** The pixels a token stands for (`:root` of tokens.css, a `rem` at 16 px). */
function tokenPx(name: string): number {
  const m = new RegExp(`${name}:\\s*([\\d.]+)(px|rem)\\s*;`).exec(read("tokens.css"));
  if (!m) throw new Error(`${name} is not a plain length in tokens.css`);
  return Number(m[1]) * (m[2] === "rem" ? 16 : 1);
}

/** A length written as `var(--token)` or `calc(var(--a) - var(--b))`, in pixels. */
function px(value: string): number {
  const text = value.trim();
  const calc = /^calc\(\s*(var\(--[\w-]+\))\s*-\s*(var\(--[\w-]+\))\s*\)$/.exec(text);
  if (calc) return px(calc[1]!) - px(calc[2]!);
  const token = /^var\((--[\w-]+)\)$/.exec(text);
  if (token) return tokenPx(token[1]!);
  throw new Error(`cannot read ${text} as a length`);
}

/** The block size each rule of `selector` asks for, as `min-block-size`, `min-height` or `block-size`. */
function blockSizes(file: string, selector: string, property: string): number[] {
  const found = sheet(file).filter((r) => r.selector === selector);
  expect(found.length, `${file} styles ${selector}`).toBeGreaterThan(0);
  const sizes = found.flatMap((r) => [...r.body.matchAll(new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`, "g"))].map((m) => px(m[1]!)));
  expect(sizes.length, `${selector} sets ${property}`).toBeGreaterThan(0);
  return sizes;
}

// WCAG 2.5.8 asks 24 px; the controls that sat at 24 to 32 px are 40 px high (a finger's width less the gap that
// surrounds them), so a thumb hits them on a phone.
const MIN = 40;

describe("touch targets", () => {
  it("makes the keys of the view switch in the header at least 40 px high", () => {
    for (const size of blockSizes("shell.css", ".topbar .scope-toggle button", "min-block-size")) expect(size).toBeGreaterThanOrEqual(MIN);
  });

  it("keeps the view switch inside the bar: its keys, the track's padding and edge are not higher than the bar", () => {
    const [key = 0] = blockSizes("shell.css", ".topbar .scope-toggle button", "min-block-size");
    const track = sheet("base.css").find((r) => r.selector === ".segmented")!.body;
    expect(track).toMatch(/padding: 2px;/);
    expect(track).toMatch(/border: 1px solid/);
    expect(key + 2 * 2 + 2 * 1).toBeLessThanOrEqual(tokenPx("--rail-h"));
  });

  it("makes the filter chips of a table at least 40 px high", () => {
    for (const size of blockSizes("toolbar.css", ".rtb-chip", "min-block-size")) expect(size).toBeGreaterThanOrEqual(MIN);
  });

  it("makes the button that opens a row at least 40 px high", () => {
    for (const size of blockSizes("table.css", ".rt-drill", "block-size")) expect(size).toBeGreaterThanOrEqual(MIN);
  });

  it("makes the links under a table (CSV, fewer rows, the next page) at least 40 px high", () => {
    for (const size of blockSizes("table.css", ":is(.rt-csv, .rt-more, .tx-cut) .btn-link", "min-block-size")) expect(size).toBeGreaterThanOrEqual(MIN);
  });
});
