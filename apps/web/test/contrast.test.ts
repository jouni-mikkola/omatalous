import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** One rule of tokens.css: the look it holds (`c` on the bare :root, else the name in `data-look`), its color-scheme and its custom properties as written. */
interface TokenSet {
  look: string;
  scheme: string | undefined;
  values: Map<string, string>;
}

/** Reads tokens.css as text, one set per `:root` rule. */
function readSets(css: string): TokenSet[] {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/:root(?:\[data-look="([a-z]+)"\])?\s*\{([^}]*)\}/g);
  return [...rules].map((m) => ({
    look: m[1] ?? "c",
    scheme: /color-scheme:\s*([a-z]+)\s*;/.exec(m[2] ?? "")?.[1],
    values: new Map([...(m[2] ?? "").matchAll(/--([a-z0-9-]+):\s*([^;]+?)\s*;/g)].map((d) => [d[1] ?? "", d[2] ?? ""] as const)),
  }));
}

/** Names that one set has and another lacks, each as a line that says which. */
function onlyInOne(sets: TokenSet[]): string[] {
  return sets.flatMap((s) => sets.flatMap((o) => [...s.values.keys()].filter((name) => !o.values.has(name)).map((name) => `--${name} is in the ${s.look} set only`)));
}

/** Values written as a hex colour that are not `#rrggbb` in lower case: the measurements below would skip or misread them. */
function notRrggbb(sets: TokenSet[]): string[] {
  return sets.flatMap((s) => [...s.values].filter(([, v]) => v.startsWith("#") && !/^#[0-9a-f]{6}$/.test(v)).map(([name, v]) => `--${name} in the ${s.look} set is ${v}`));
}

/** The WCAG 2 measurements of one set's colours. */
function measure(set: TokenSet) {
  const hex = (name: string): string => {
    const value = set.values.get(name);
    if (!value || !/^#[0-9a-f]{6}$/.test(value)) throw new Error(`--${name} is not a #rrggbb token in the ${set.look} set of tokens.css`);
    return value;
  };
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
  const hue = (name: string): number => {
    const [r, g, b] = [0, 1, 2].map((i) => parseInt(hex(name).slice(1 + 2 * i, 3 + 2 * i), 16) / 255) as [number, number, number];
    const d = Math.max(r, g, b) - Math.min(r, g, b);
    if (d === 0) return 0;
    const h = Math.max(r, g, b) === r ? ((g - b) / d + 6) % 6 : Math.max(r, g, b) === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return h * 60;
  };
  /** The pairs (`a on b`) under `min`, named with their figure so a failure says which colour to move. */
  const below = (min: number, foregrounds: string[], backgrounds: string[]): string[] =>
    foregrounds.flatMap((a) => backgrounds.filter((b) => ratio(a, b) < min).map((b) => `${a} on ${b}: ${ratio(a, b).toFixed(2)} < ${min}`));
  return { hex, luminance, ratio, hue, below };
}

const css = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
const sets = readSets(css);

/**
 * What the classic set holds: the values `:root` had before the file held two sets, pinned here token by token, and then
 * the tokens added with the second set, each with the value of the rule it stands for. Every name is also required in the
 * night set, so this is the list of tokens the sets share.
 */
const CLASSIC: Record<string, string> = {
  "page": "#c8cdd6", "surface": "#d8dce2", "surface-2": "#c4cad3",
  "text": "#131b29", "text-2": "#2a3444", "muted": "#414b5c",
  "grid": "#b4bbc6", "axis": "#6f7683", "border": "#a7afbb",
  "ink": "#1b2f54", "on-ink": "#f2f4f7", "ink-2": "#2a4170", "on-ink-2": "#cfd8e8",
  "accent": "#2456a6", "accent-ink": "#1d4a90",
  "good": "#1a5a38", "bad": "#912a2b", "warn": "#6e4306",
  "warn-bg": "#e0d3ab", "good-bg": "#c6dccd", "info-bg": "#c5d3e8",
  "series-1": "#2f6db5", "series-2": "#c2501a", "series-3": "#12796d", "series-4": "#946600",
  "series-5": "#bf3f74", "series-6": "#2e5e2e", "series-7": "#58389e", "series-rest": "#6a7280", "series-avg": "#6a7280",
  "heat-1": "#9db8d9", "heat-2": "#6f98cc", "heat-3": "#2f6db5", "heat-4": "#1d4a8a",
  "heat-ink-1": "#131b29", "heat-ink-2": "#131b29", "heat-ink-3": "#ffffff", "heat-ink-4": "#ffffff",
  "plate": "#ffffff", "plate-ink": "#0b0b0b", "plate-edge": "rgb(11 11 11 / 0.14)",
  "pop-shadow": "0 8px 28px rgb(19 27 41 / 0.28)", "backdrop": "rgb(19 27 41 / 0.55)", "shadow": "none", "radius": "10px",
  // new: a filled button is --ink on --on-ink; a button, an input and a select are --surface with a --border edge that goes to --axis under the pointer
  "fill": "#1b2f54", "on-fill": "#f2f4f7",
  "control": "#d8dce2", "control-hover": "#d8dce2", "control-edge": "#a7afbb", "control-edge-hover": "#6f7683",
  // new: a menu has the --border edge; the band's own colour leaves no line under it; a bar is one --accent; a curve ends in --accent with the surface as its halo
  "pop-edge": "#a7afbb", "bar-edge": "#1b2f54",
  "spectrum-1": "#2456a6", "spectrum-2": "#2456a6", "spectrum-3": "#2456a6", "spectrum-4": "#2456a6",
  "dot": "#2456a6", "dot-halo": "rgb(216 220 226 / 1)",
  // new: a button is 6px round, a link of the band and a box in a card 8px, an input, a select and a notice 6px
  "radius-pill": "6px", "radius-m": "8px", "radius-s": "6px",
};

describe("tokens.css sets", () => {
  it("holds the night look on :root and the classic look on :root[data-look=\"classic\"], each with its own color-scheme", () => {
    expect(sets.map((s) => [s.look, s.scheme]).sort()).toEqual([["c", "dark"], ["classic", "light"]]);
  });

  it("has every token in both sets, and none in one set only", () => {
    const missing = sets.flatMap((s) => Object.keys(CLASSIC).filter((name) => !s.values.has(name)).map((name) => `--${name} is missing from the ${s.look} set`));
    expect(missing).toEqual([]);
    expect(onlyInOne(sets)).toEqual([]);
  });

  it("writes every hex colour as #rrggbb in lower case", () => {
    expect(notRrggbb(sets)).toEqual([]);
  });

  it("keeps the classic set at the values the screen had before the two sets, token by token", () => {
    const classic = sets.find((s) => s.look === "classic");
    const differing = Object.entries(CLASSIC).filter(([name, value]) => classic?.values.get(name) !== value).map(([name, value]) => `--${name}: ${classic?.values.get(name)} is not ${value}`);
    expect(differing).toEqual([]);
  });

  it("is checked by what it checks: a name in one set only, and a hex that is not #rrggbb, are found; complete sets are not", () => {
    const sample = (night: string, classic: string) => readSets(`:root { color-scheme: dark; ${night} } :root[data-look="classic"] { color-scheme: light; ${classic} }`);
    expect(onlyInOne(sample("--a: #000000; --b: #111111;", "--a: #ffffff;"))).toEqual(["--b is in the c set only"]);
    expect(onlyInOne(sample("--a: #000000;", "--a: #ffffff; --b: 4px;"))).toEqual(["--b is in the classic set only"]);
    expect(onlyInOne(sample("--a: #000000; --b: 4px;", "--a: #ffffff; --b: 6px;"))).toEqual([]);
    expect(notRrggbb(sample("--a: #ABCDEF; --b: #abc;", "--a: #abcdef; --b: rgb(0 0 0 / 0.5);"))).toEqual(["--a in the c set is #ABCDEF", "--b in the c set is #abc"]);
  });
});

const TINTS = ["warn-bg", "good-bg", "info-bg"];
const GROUNDS = ["page", "surface", "surface-2"];
const SERIES = ["series-1", "series-2", "series-3", "series-4", "series-5", "series-6", "series-7", "series-rest", "series-avg"];
const HEAT = ["heat-1", "heat-2", "heat-3", "heat-4"];

describe.each(sets)("tokens.css contrast, $look set", (set) => {
  const { hex, luminance, ratio, hue, below } = measure(set);
  const dark = set.scheme === "dark";
  // the colour of a filled control is text on the grounds too; the light set also keeps --ink, which it had as text before --fill existed
  const TEXTS = ["text", "text-2", "muted", "fill", "accent-ink", "good", "bad", "warn", ...(dark ? [] : ["ink"])];

  it("every text token reads on the page and on both surfaces at 4.5 to 1", () => {
    expect(below(4.5, TEXTS, GROUNDS)).toEqual([]);
  });

  it("text on the three tinted backgrounds reads at 4.5 to 1", () => {
    expect(below(4.5, TEXTS, TINTS)).toEqual([]);
  });

  it("text and second text read on the page and on both surfaces at 7 to 1", () => {
    expect(below(7, ["text", "text-2"], GROUNDS)).toEqual([]);
  });

  it("muted reads on the surface at 6 to 1 and on the page and the second surface at 4.5 to 1", () => {
    expect([...below(6, ["muted"], ["surface"]), ...below(4.5, ["muted"], ["page", "surface-2"])]).toEqual([]);
  });

  it("accent, good, bad and warn read on the surface at 4.5 to 1", () => {
    expect(below(4.5, ["accent", "good", "bad", "warn"], ["surface"])).toEqual([]);
  });

  it("the header band: --on-ink and --on-ink-2 read on --ink at 7 to 1, --on-ink on the band's hover colour --ink-2 too, --ink on --on-ink, the page you are on, at 4.5, and in the light set --on-ink on --accent at 4.5", () => {
    expect([
      ...below(7, ["on-ink", "on-ink-2"], ["ink"]),
      ...below(7, ["on-ink"], ["ink-2"]),
      ...below(4.5, ["ink"], ["on-ink"]),
      // no rule draws the band's text on the accent, but the light set always met it and keeps it
      ...(dark ? [] : below(4.5, ["on-ink"], ["accent"])),
    ]).toEqual([]);
  });

  it("a filled control: --on-fill reads on --fill, and the text on a button and on a button under the pointer reads, at 4.5 to 1 with the muted text on the latter", () => {
    expect([...below(4.5, ["on-fill"], ["fill"]), ...below(4.5, ["text"], ["control", "control-hover"]), ...below(4.5, ["muted"], ["control-hover"])]).toEqual([]);
  });

  it("series colours and the two heat steps farthest from the surface show on the surface at 3 to 1", () => {
    expect(below(3, [...SERIES, "heat-3", "heat-4"], ["surface"])).toEqual([]);
  });

  it("the heat ladder moves away from the surface by at least 1.3 to 1 per step, darker in a light set and brighter in a dark one, with its ink at 4.5 to 1", () => {
    const steps = ["surface", ...HEAT];
    const stepFails = HEAT.filter((h, i) => {
      const from = steps[i] ?? "surface";
      return ratio(h, from) < 1.3 || (dark ? luminance(h) <= luminance(from) : luminance(h) >= luminance(from));
    });
    expect(stepFails).toEqual([]);
    const inks = HEAT.map((h) => `heat-ink-${h.slice(5)}`);
    expect(HEAT.flatMap((h, i) => below(4.5, [inks[i] ?? ""], [h]))).toEqual([]);
  });

  it("border is 1.5 to 1 off the surface, grid 1.3, axis 3", () => {
    expect([...below(1.5, ["border"], ["surface"]), ...below(1.3, ["grid"], ["surface"]), ...below(3, ["axis"], ["surface"])]).toEqual([]);
  });

  it("night set: text reads on the lit top of a panel and on its violet glow, and a control edge and the axis show at 3 to 1", () => {
    if (!dark) return;
    // glass.css lays up to 5 % white and 4 % of the violet glow over --surface; both are mixed over it here
    const mix = (top: string, alpha: number): string => "#" + [0, 1, 2].map((i) => Math.round(parseInt(hex("surface").slice(1 + 2 * i, 3 + 2 * i), 16) * (1 - alpha) + parseInt(top.slice(1 + 2 * i, 3 + 2 * i), 16) * alpha).toString(16).padStart(2, "0")).join("");
    const lit = measure({ ...set, values: new Map([...set.values, ["lit", mix("#ffffff", 0.05)], ["glow", mix("#6a5cf0", 0.04)]]) });
    expect([...lit.below(7, ["text", "text-2"], ["lit", "glow"]), ...lit.below(4.5, ["muted", "accent", "good", "bad", "warn"], ["lit", "glow"])]).toEqual([]);
    expect([...below(3, ["control-edge"], ["control", "surface"]), ...below(3, ["axis"], ["surface", "page"])]).toEqual([]);
  });

  it("text reads on the three tinted backgrounds at 7 to 1 in the night set", () => {
    expect(below(dark ? 7 : 0, ["text"], TINTS)).toEqual([]);
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

  it("a card stands out from the page by 1.10 to 1, and the second surface and the tints sit on the sides the set's brightness gives them", () => {
    const lift = (luminance("surface") + 0.05) / (luminance("page") + 0.05);
    expect(lift, `surface against page: ${lift.toFixed(2)} < 1.10`).toBeGreaterThanOrEqual(1.1);
    if (dark) {
      // a dark set raises: the second surface is brighter than the surface and the tints are no darker than it
      expect(luminance("surface-2")).toBeGreaterThan(luminance("surface"));
      expect(TINTS.filter((t) => luminance(t) < luminance("surface"))).toEqual([]);
    } else {
      expect(luminance("surface-2")).toBeLessThan(luminance("page"));
      expect(TINTS.filter((t) => luminance(t) > luminance("surface"))).toEqual([]);
    }
  });

});

describe("index.html", () => {
  it("the colour the browser draws around the page (theme-color) is the colour of the header band, --ink, of the set the page selects", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const look = /<html\b[^>]*\sdata-look="([a-z]+)"/i.exec(html)?.[1] ?? "c";
    const selected = sets.find((s) => s.look === look);
    expect(selected, `index.html selects the look ${look}, tokens.css has no such set`).toBeDefined();
    expect(html.match(/<meta name="theme-color" content="(#[0-9a-f]{6})"/i)?.[1]).toBe(selected && measure(selected).hex("ink"));
  });
});
