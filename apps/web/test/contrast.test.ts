import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hex as HEX } from "../src/design/tokens.ts";

// The app has one look: a light, bank-like one (docs/DESIGN.md). The colours are measured from the generated #rrggbb list of
// src/design/tokens.ts, which tokens.test.ts holds equal to design/tokens.json.
type Name = keyof typeof HEX;

const channel = (c: string, i: number): number => {
  const v = parseInt(c.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
/** The three channels in linear light. */
const linear = (name: Name): [number, number, number] => [channel(HEX[name], 0), channel(HEX[name], 1), channel(HEX[name], 2)];
const luminance = (name: Name): number => {
  const [r, g, b] = linear(name);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: Name, b: Name): number => {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const hue = (name: Name): number => {
  const [r, g, b] = [0, 1, 2].map((i) => parseInt(HEX[name].slice(1 + 2 * i, 3 + 2 * i), 16) / 255) as [number, number, number];
  const d = Math.max(r, g, b) - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = Math.max(r, g, b) === r ? ((g - b) / d + 6) % 6 : Math.max(r, g, b) === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
};
/** The pairs (`a on b`) under `min`, named with their figure so a failure says which colour to move. */
const below = (min: number, foregrounds: Name[], backgrounds: Name[]): string[] =>
  foregrounds.flatMap((a) => backgrounds.filter((b) => ratio(a, b) < min).map((b) => `${a} on ${b}: ${ratio(a, b).toFixed(2)} < ${min}`));

// Colour-blind simulation (Machado et al. 2009, severity 1) in linear light, and the distance in OKLab.
const CVD = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
} as const;
const clamp = (x: number): number => Math.min(1, Math.max(0, x));
const oklab = ([r, g, b]: number[]): number[] => {
  const l = Math.cbrt(0.4122214708 * r! + 0.5363325363 * g! + 0.0514459929 * b!);
  const m = Math.cbrt(0.2119034982 * r! + 0.6806995451 * g! + 0.1073969566 * b!);
  const s = Math.cbrt(0.0883024619 * r! + 0.2817188376 * g! + 0.6299787005 * b!);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
const seen = (name: Name, kind: keyof typeof CVD): number[] => {
  const lin = linear(name);
  return oklab(CVD[kind].map((row) => clamp(row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2])));
};
const apart = (a: Name, b: Name, kind: keyof typeof CVD): number => {
  const [x, y] = [seen(a, kind), seen(b, kind)];
  return Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!);
};

const TINTS: Name[] = ["warn-bg", "good-bg", "info-bg", "bad-bg"];
const GROUNDS: Name[] = ["page", "surface", "surface-2"];
const TEXTS: Name[] = ["text", "text-2", "muted", "accent-ink", "good", "bad", "warn"];
const SERIES: Name[] = ["series-1", "series-2", "series-3", "series-4", "series-5", "series-6", "series-7"];
const HEAT: Name[] = ["heat-1", "heat-2", "heat-3", "heat-4"];

describe("tokens.css contrast, the one look, light", () => {
  it("every text token reads on the page and on both surfaces at 7 to 1", () => {
    expect(below(7, TEXTS, GROUNDS)).toEqual([]);
  });

  it("text reads on the four tinted backgrounds at 7 to 1", () => {
    expect(below(7, TEXTS, TINTS)).toEqual([]);
  });

  it("the text is not pure black and the page not pure white", () => {
    expect(luminance("text")).toBeGreaterThan(0.005);
    expect(luminance("page")).toBeLessThan(0.95);
  });

  it("the header band: --on-ink and --on-ink-2 read on --ink at 7 to 1, --on-ink on its hover colour too", () => {
    expect([...below(7, ["on-ink", "on-ink-2"], ["ink"]), ...below(7, ["on-ink"], ["ink-2"])]).toEqual([]);
  });

  it("a filled control: --on-fill reads on --fill at 7 to 1, the text on a button and under the pointer at 7 to 1", () => {
    expect([...below(7, ["on-fill"], ["fill"]), ...below(7, ["text", "muted"], ["control", "control-hover"])]).toEqual([]);
  });

  it("the parts of the interface show at 3 to 1: the edge of a control, the axis, a popup's edge, the accent", () => {
    expect(below(3, ["control-edge", "axis", "pop-edge", "accent", "control-edge-hover"], [...GROUNDS, "control"])).toEqual([]);
  });

  it("series colours, saved, earned, rise and fall show on the page and both surfaces at 3 to 1", () => {
    expect(below(3, [...SERIES, "series-rest", "series-avg", "saved", "earned", "rise", "fall"], GROUNDS)).toEqual([]);
  });

  it("the heat ladder moves darker by at least 1.3 to 1 per step from the surface, each step's ink reads on it at 7 to 1", () => {
    const steps: Name[] = ["surface", ...HEAT];
    const stepFails = HEAT.filter((h, i) => ratio(h, steps[i] ?? "surface") < 1.3 || luminance(h) >= luminance(steps[i] ?? "surface"));
    expect(stepFails).toEqual([]);
    expect(HEAT.flatMap((h) => below(7, [`heat-ink-${h.slice(5)}` as Name], [h]))).toEqual([]);
  });

  it("border is 1.5 to 1 off the surface and grid 1.3", () => {
    expect([...below(1.5, ["border"], ["surface"]), ...below(1.3, ["grid"], ["surface"])]).toEqual([]);
  });

  it("neighbouring series differ by 1.2 to 1 in luminance or by 60 degrees of hue", () => {
    const alike = SERIES.slice(1).flatMap((b, i) => {
      const a = SERIES[i] ?? "series-1";
      const turn = Math.abs(hue(a) - hue(b));
      const hueDiff = Math.min(turn, 360 - turn);
      return ratio(a, b) >= 1.2 || hueDiff >= 60 ? [] : [`${a} and ${b}: ${ratio(a, b).toFixed(2)} in luminance, ${hueDiff.toFixed(0)} degrees`];
    });
    expect(alike).toEqual([]);
  });

  it("the status colours stay apart for a reader with protan, deutan or tritan sight (OKLab distance 0.08)", () => {
    const pairs: [Name, Name][] = [["good", "bad"], ["good", "warn"], ["bad", "warn"], ["rise", "fall"]];
    const close = pairs.flatMap(([a, b]) => (Object.keys(CVD) as (keyof typeof CVD)[]).filter((k) => apart(a, b, k) < 0.08).map((k) => `${a} and ${b} as ${k}: ${apart(a, b, k).toFixed(3)}`));
    expect(close).toEqual([]);
  });

  it("the surface stands at least 1.08 to 1 off the page, the second surface is darker than the surface, the tints are no brighter than the well", () => {
    expect(ratio("surface", "page")).toBeGreaterThanOrEqual(1.08);
    expect(luminance("surface-2")).toBeLessThan(luminance("surface"));
    expect(TINTS.filter((t) => luminance(t) > luminance("well"))).toEqual([]);
  });
});

describe("index.html", () => {
  it("the colour the browser draws around the page (theme-color) is the colour of the header band, --ink, and the scheme is light", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    expect(html.match(/<meta name="theme-color" content="(#[0-9a-f]{6})"/i)?.[1]).toBe(HEX.ink);
    expect(html.match(/<meta name="color-scheme" content="([a-z ]+)"/i)?.[1]).toBe("light");
    expect(html).not.toMatch(/data-look/);
  });
});
