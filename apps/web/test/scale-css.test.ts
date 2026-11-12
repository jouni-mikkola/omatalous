import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Every stylesheet of the web app, the private pages' too, as its path under src and its rules without comments. The drawn
 * card face of holdings.css (`.card-face`) is left out: it scales its words and gaps with its own width and has its own
 * colours, so no token reaches it (card-face.test.ts). fonts.css is left out too: its font-weight is the range the face holds.
 */
function sheets(): [string, string][] {
  const root = new URL("../src/", import.meta.url);
  return (readdirSync(root, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".css") && f !== "styles/fonts.css")
    .sort()
    .map((f): [string, string] => [f, withoutFace(readFileSync(new URL(f, root), "utf8"))]);
}

/** The rule bodies of a sheet, one a line, without the rules of the card face. */
function withoutFace(css: string): string {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => !m[1]!.includes(".card-face"))
    .map((m) => `${m[1]!.trim()} { ${m[2]!.trim()} }`)
    .join("\n");
}

/** Each `font-size` that is a number of its own and not a step of the scale (0 hides a word and is no size). */
function sizeLiterals(css: string): string[] {
  return [...css.matchAll(/font-size:\s*([^;}]+)/g)].map((m) => m[1]!.trim()).filter((v) => !v.startsWith("var(--fs-") && v !== "0" && v !== "inherit");
}

/** Each font-weight other than the two of the scale. */
function weightLiterals(css: string): string[] {
  return [...css.matchAll(/font-weight:\s*([^;}]+)/g)].map((m) => m[1]!.trim()).filter((v) => !["400", "600", "var(--w-regular)", "var(--w-strong)", "inherit", "normal"].includes(v));
}

/** Each padding, margin or gap in px off the 4 px step; 1 and 2 px stay (a hairline, the inside of a control); calc is left to its tokens. */
function offStep(css: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/(?<![-\w])((?:padding|margin)(?:-[a-z-]+)?|gap|row-gap|column-gap)\s*:\s*([^;}]+)/g)) {
    const value = m[2]!.trim();
    if (value.includes("calc(")) continue;
    for (const px of value.matchAll(/(?<![\d.-])-?(\d+)px/g)) {
      const n = Number(px[1]);
      if (n > 2 && n % 4 !== 0) out.push(`${m[1]}: ${value}`);
    }
  }
  return out;
}

describe("the type scale and the spacing step in every stylesheet", () => {
  it("finds a size, a weight and a spacing that are off the scale, and passes the tokens", () => {
    const css = ".a { font-size: 13px; font-weight: 500; padding: 6px 8px; } .b { font-size: var(--fs-ui); font-weight: 600; margin: 0 2px; gap: var(--sp-8); padding: calc(var(--pad) - 3px); font-size: 0; }";
    expect(sizeLiterals(css)).toEqual(["13px"]);
    expect(weightLiterals(css)).toEqual(["500"]);
    expect(offStep(css)).toEqual(["padding: 6px 8px"]);
  });

  it("reads every font-size from the scale (tokens.css), so a page sets no size of its own", () => {
    const found = sheets().flatMap(([f, css]) => sizeLiterals(css).map((v) => `${f}: ${v}`));
    expect(found).toEqual([]);
  });

  it("has five sizes in the scale, 12, 14, 16, 20 and 32 px, and the display size of 3.25 rem for the answer number only", () => {
    const tokens = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
    const sizes = [...new Set([...tokens.matchAll(/--fs-[a-z0-9-]+:\s*(\d+)px/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
    expect(sizes).toEqual([12, 14, 16, 20, 32]);
    expect(/--fs-display:\s*([^;]+);/.exec(tokens)?.[1]).toBe("3.25rem");
    const users = sheets().flatMap(([f, css]) => (css.includes("var(--fs-display)") ? [f] : []));
    expect(users, "the display size stands in one place, the answer number").toHaveLength(1);
  });

  it("uses the two weights only", () => {
    const found = sheets().flatMap(([f, css]) => weightLiterals(css).map((v) => `${f}: ${v}`));
    expect(found).toEqual([]);
  });

  it("puts every padding, margin and gap on the 4 px step", () => {
    const found = sheets().flatMap(([f, css]) => offStep(css).map((v) => `${f}: ${v}`));
    expect(found).toEqual([]);
  });

  it("sets the bare h3 and p of Asetukset to the body size and the spacing tokens", () => {
    const css = readFileSync(new URL("../src/styles/settings.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    // the scope is the markup of Settings.tsx: a .stack whose direct child is the .tabs nav
    const page = readFileSync(new URL("../src/pages/Settings.tsx", import.meta.url), "utf8");
    expect(page).toMatch(/<div className="stack">\s*<nav className="tabs"/);
    for (const tag of ["h3", "p"]) {
      const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => m[1]!.trim() === `:where(.stack:has(> .tabs)) ${tag}:not([class])`);
      expect(rule, tag).toBeDefined();
      expect(rule![2], tag).toMatch(/font-size:\s*var\(--fs-body\)/);
      const margin = /margin:\s*([^;]+)/.exec(rule![2]!)?.[1]?.trim().split(/\s+/) ?? [];
      expect(margin.length, tag).toBeGreaterThan(0);
      for (const v of margin) expect(v === "0" || /^var\(--sp-\d+\)$/.test(v), `${tag} margin ${v}`).toBe(true);
    }
  });
});

describe("the row arrow of the tables", () => {
  it("makes the row arrow a 44 px touch target that does not grow the row", () => {
    const css = readFileSync(new URL("../src/styles/table.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const m = css.match(/@media \(pointer: coarse\)\s*\{([\s\S]*?)\n\}/);
    expect(m).not.toBeNull();
    const body = m![1]!;
    expect(body).toMatch(/\.rt-drill\s*\{[^}]*position:\s*relative;\s*z-index:\s*1;[^}]*inline-size:\s*var\(--tap-min\)[^}]*block-size:\s*var\(--tap-min\)[^}]*margin:\s*-12px 0 -12px -16px/);
    expect(body).toMatch(/\.rt-wrap\[data-block\] \.rt-drill\s*\{[^}]*margin:\s*-12px -16px -12px 0/);
  });
});

describe("a price rise", () => {
  it("is not coloured with the bad tokens", () => {
    const css = readFileSync(new URL("../src/styles/table.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...css.matchAll(/([^{}]*\.rt-delta-rise[^{}]*)\{([^{}]*)\}/g)];
    expect(rules.length).toBeGreaterThan(0);
    for (const m of rules) expect(m[2]).not.toMatch(/--bad(-bg)?\b/);
    expect(rules.map((m) => m[2]).join(" ")).toContain("--accent");
  });
});
