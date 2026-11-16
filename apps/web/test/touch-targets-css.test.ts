import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rules } from "./css-kit.ts";

const read = (name: string) => readFileSync(new URL(`../src/styles/${name}`, import.meta.url), "utf8");
const sheet = (name: string) => rules(read(name));

type Screen = "mouse" | "touch";

/** The declaration of a custom property in the `@media (pointer: coarse)` root block of tokens.css, if it has one. */
function coarseToken(name: string): string | undefined {
  const block = /@media \(pointer: coarse\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(read("tokens.css"));
  return block && new RegExp(`${name}:\\s*([^;]+);`).exec(block[1]!)?.[1];
}

/** The pixels a token stands for (`:root` of tokens.css, a `rem` at 16 px); on a touch screen the coarse block wins. */
function tokenPx(name: string, screen: Screen): number {
  const coarse = screen === "touch" ? coarseToken(name) : undefined;
  if (coarse) return px(coarse, screen);
  const m = new RegExp(`${name}:\\s*([\\d.]+)(px|rem)\\s*;`).exec(read("tokens.css"));
  if (!m) throw new Error(`${name} is not a plain length in tokens.css`);
  return Number(m[1]) * (m[2] === "rem" ? 16 : 1);
}

/** The top-level arguments of a function call, split at its commas. */
function args(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "(") depth++;
    else if (inner[i] === ")") depth--;
    else if (inner[i] === "," && depth === 0) {
      out.push(inner.slice(from, i));
      from = i + 1;
    }
  }
  return [...out, inner.slice(from)];
}

/** A length written as a literal, `var(--token)`, `calc(a - b)` or `max(a, b)`, in pixels on the given screen. */
function px(value: string, screen: Screen): number {
  const text = value.trim();
  const lit = /^([\d.]+)(px|rem)$/.exec(text);
  if (lit) return Number(lit[1]) * (lit[2] === "rem" ? 16 : 1);
  const token = /^var\((--[\w-]+)\)$/.exec(text);
  if (token) return tokenPx(token[1]!, screen);
  const calc = /^calc\((.*)\)$/.exec(text);
  if (calc) {
    const [a, b, ...rest] = calc[1]!.split(/\s+-\s+/);
    if (a !== undefined && b !== undefined && rest.length === 0) return px(a, screen) - px(b, screen);
  }
  const max = /^max\((.*)\)$/.exec(text);
  if (max) return Math.max(...args(max[1]!).map((a) => px(a, screen)));
  throw new Error(`cannot read ${text} as a length`);
}

/** The block size each rule of `selector` asks for, as `min-block-size`, `min-height` or `block-size`. */
function blockSizes(file: string, selector: string, property: string, screen: Screen = "mouse"): number[] {
  const found = sheet(file).filter((r) => r.selector === selector);
  expect(found.length, `${file} styles ${selector}`).toBeGreaterThan(0);
  const sizes = found.flatMap((r) => [...r.body.matchAll(new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`, "g"))].map((m) => px(m[1]!, screen)));
  expect(sizes.length, `${selector} sets ${property}`).toBeGreaterThan(0);
  return sizes;
}

// WCAG 2.5.8 asks 24 px; the controls that sat at 24 to 32 px are 40 px high (a finger's width less the gap that
// surrounds them), so a thumb hits them on a phone.
const MIN = 40;
const LINKS = ":is(.rt-csv, .rt-more, .tx-cut) .btn.btn-link";

/** The weight of a selector as ids, classes and elements: `:is()` and `:not()` count as their heaviest argument, `:where()` as nothing. */
function specificity(selector: string): [number, number, number] {
  let rest = selector;
  let ids = 0;
  let classes = 0;
  let elements = 0;
  for (let m = /:(is|not|where|has)\(/.exec(rest); m; m = /:(is|not|where|has)\(/.exec(rest)) {
    let depth = 1;
    let end = m.index + m[0].length;
    for (; depth > 0 && end < rest.length; end++) depth += rest[end] === "(" ? 1 : rest[end] === ")" ? -1 : 0;
    if (m[1] !== "where") {
      const [a = 0, b = 0, c = 0] = args(rest.slice(m.index + m[0].length, end - 1)).map(specificity).sort(compare).at(-1) ?? [];
      ids += a;
      classes += b;
      elements += c;
    }
    rest = `${rest.slice(0, m.index)} ${rest.slice(end)}`;
  }
  classes += rest.match(/\[[^\]]*\]/g)?.length ?? 0;
  rest = rest.replace(/\[[^\]]*\]/g, " ");
  ids += rest.match(/#[\w-]+/g)?.length ?? 0;
  classes += (rest.match(/\.[\w-]+/g)?.length ?? 0) + (rest.match(/(?<!:):[\w-]+/g)?.length ?? 0);
  elements += (rest.match(/(?:^|[\s>+~])[a-z][\w-]*/gi)?.length ?? 0) + (rest.match(/::[\w-]+/g)?.length ?? 0);
  return [ids, classes, elements];
}

/** Positive when `a` weighs more than `b`. */
const compare = (a: readonly number[], b: readonly number[]): number => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;

describe("touch targets", () => {
  it("makes the keys of the view switch in the header at least 40 px high", () => {
    for (const size of blockSizes("shell.css", ".topbar .scope-toggle button", "min-block-size")) expect(size).toBeGreaterThanOrEqual(MIN);
  });

  it("keeps the view switch inside the bar: its keys, the track's padding and edge are not higher than the bar", () => {
    const [key = 0] = blockSizes("shell.css", ".topbar .scope-toggle button", "min-block-size");
    const track = sheet("base.css").find((r) => r.selector === ".segmented")!.body;
    expect(track).toMatch(/padding: 2px;/);
    expect(track).toMatch(/border: 1px solid/);
    expect(key + 2 * 2 + 2 * 1).toBeLessThanOrEqual(tokenPx("--rail-h", "mouse"));
  });

  it("makes the filter chips of a table at least 40 px high, and never lower than the control height of a touch screen", () => {
    for (const size of blockSizes("toolbar.css", ".rtb-chip", "min-block-size")) expect(size).toBeGreaterThanOrEqual(MIN);
    // the chip was `var(--control-h)` before: 44 px on a touch screen, which it keeps
    for (const size of blockSizes("toolbar.css", ".rtb-chip", "min-block-size", "touch")) expect(size).toBeGreaterThanOrEqual(tokenPx("--control-h", "touch"));
  });

  it("makes the button that opens a row at least 40 px high", () => {
    for (const screen of ["mouse", "touch"] as const) {
      for (const size of blockSizes("table.css", ".rt-drill", "block-size", screen)) expect(size).toBeGreaterThanOrEqual(MIN);
    }
  });

  it("makes the links under a table (CSV, fewer rows, the next page) at least 40 px high", () => {
    for (const screen of ["mouse", "touch"] as const) {
      for (const size of blockSizes("table.css", LINKS, "min-block-size", screen)) expect(size).toBeGreaterThanOrEqual(MIN);
    }
  });

  it("weighs the selector of those links more than every rule of base.css that sets a height on a link", () => {
    // base.css gives a phone's link a 24 px floor in an `:is()`, which weighs as much as its heaviest argument
    const ours = specificity(LINKS);
    const rivals = sheet("base.css").filter((r) => /(?:^|;)\s*min-(?:height|block-size):/.test(r.body) && r.selector.includes(".btn-link"));
    expect(rivals.length).toBeGreaterThan(0);
    for (const rival of rivals) {
      for (const part of args(rival.selector)) {
        if (part.includes(".btn-link")) expect(compare(ours, specificity(part)), `${LINKS} against ${part.trim()}`).toBeGreaterThan(0);
      }
    }
  });
});
