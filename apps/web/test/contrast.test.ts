import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Reads tokens.css as text and measures its colours with the WCAG 2 formulas. */
const css = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
const tokens = new Map([...css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2]] as const));

function hex(name: string): string {
  const value = tokens.get(name);
  if (!value) throw new Error(`--${name} is not a #rrggbb token in tokens.css`);
  return value;
}
const channel = (c: string, i: number): number => {
  const v = parseInt(c.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (name: string): number => {
  const c = hex(name);
  return 0.2126 * channel(c, 0) + 0.7152 * channel(c, 1) + 0.0722 * channel(c, 2);
};
const ratio = (a: string, b: string): number => {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
function hue(name: string): number {
  const [r, g, b] = [0, 1, 2].map((i) => parseInt(hex(name).slice(1 + 2 * i, 3 + 2 * i), 16) / 255) as [number, number, number];
  const d = Math.max(r, g, b) - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = Math.max(r, g, b) === r ? ((g - b) / d + 6) % 6 : Math.max(r, g, b) === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
}

/** The pairs (`a on b`) under `min`, named with their figure so a failure says which colour to move. */
function below(min: number, foregrounds: string[], backgrounds: string[]): string[] {
  return foregrounds.flatMap((a) =>
    backgrounds.filter((b) => ratio(a, b) < min).map((b) => `${a} on ${b}: ${ratio(a, b).toFixed(2)} < ${min}`),
  );
}

const TEXTS = ["text", "text-2", "muted", "ink", "accent-ink", "good", "bad", "warn"];
const GROUNDS = ["page", "surface", "surface-2"];
const TINTS = ["warn-bg", "good-bg", "info-bg"];
const SERIES = ["series-1", "series-2", "series-3", "series-4", "series-5", "series-6", "series-7", "series-rest", "series-avg"];
const HEAT = ["heat-1", "heat-2", "heat-3", "heat-4"];

describe("tokens.css contrast", () => {
  it("every text token reads on the page and on both surfaces at 4.5 to 1", () => {
    expect(below(4.5, TEXTS, GROUNDS)).toEqual([]);
  });

  it("text on the three tinted backgrounds reads at 4.5 to 1", () => {
    expect(below(4.5, TEXTS, TINTS)).toEqual([]);
  });

  it("--on-ink reads on --ink and on --accent at 4.5 to 1", () => {
    expect(below(4.5, ["on-ink"], ["ink", "accent"])).toEqual([]);
  });

  it("--accent, which only draws edges and rings (the text is --accent-ink), shows on the surface at 3 to 1", () => {
    expect(below(3, ["accent"], ["surface"])).toEqual([]);
  });

  it("series colours and the two darkest heat steps show on the surface at 3 to 1", () => {
    expect(below(3, [...SERIES, "heat-3", "heat-4"], ["surface"])).toEqual([]);
  });

  it("the heat ladder darkens by at least 1.3 to 1 per step from the surface, with its ink at 4.5 to 1", () => {
    const steps = ["surface", ...HEAT];
    const stepFails = HEAT.filter((h, i) => ratio(h, steps[i] ?? "surface") < 1.3 || luminance(h) >= luminance(steps[i] ?? "surface"));
    expect(stepFails).toEqual([]);
    const inks = HEAT.map((h) => `heat-ink-${h.slice(5)}`);
    expect(HEAT.flatMap((h, i) => below(4.5, [inks[i] ?? ""], [h]))).toEqual([]);
  });

  it("border is 1.3 to 1 off the surface, grid 1.2, axis 3", () => {
    expect([...below(1.3, ["border"], ["surface"]), ...below(1.2, ["grid"], ["surface"]), ...below(3, ["axis"], ["surface"])]).toEqual([]);
  });

  it("neighbouring series differ by 1.2 to 1 in luminance or by 60 degrees of hue", () => {
    const order = SERIES.slice(0, 8);
    const alike = order.slice(1).flatMap((b, i) => {
      const a = order[i] ?? "";
      const turn = Math.abs(hue(a) - hue(b));
      const hueDiff = Math.min(turn, 360 - turn);
      return ratio(a, b) >= 1.2 || hueDiff >= 60 ? [] : [`${a} and ${b}: ${ratio(a, b).toFixed(2)} in luminance, ${hueDiff.toFixed(0)} degrees`];
    });
    expect(alike).toEqual([]);
  });

  it("the page stays between 0.70 and 0.76 in luminance and the surface 0.06 above it, with surface-2 and the tints no brighter than the surface", () => {
    expect(luminance("page")).toBeGreaterThanOrEqual(0.7);
    expect(luminance("page")).toBeLessThanOrEqual(0.76);
    expect(luminance("surface") - luminance("page")).toBeCloseTo(0.061, 2);
    expect(luminance("surface-2")).toBeLessThan(luminance("page"));
    expect(TINTS.filter((t) => luminance(t) > luminance("surface"))).toEqual([]);
  });

  it("the colour the browser draws around the page (theme-color in index.html) is the page colour", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    expect(html.match(/<meta name="theme-color" content="(#[0-9a-f]{6})"/i)?.[1]).toBe(hex("page"));
  });
});
