import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rules } from "./css-kit.ts";

/**
 * The selectors of base.css's top-level rules, in file order (a `@media` block counts as one rule, by its query). A
 * cascade layer (`@layer x { ... }`) is a wrapper: the rules inside it count as top level.
 */
function topLevelSelectors(css: string): string[] {
  const out: string[] = [];
  const open: boolean[] = [];
  let depth = 0;
  let head = "";
  for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (ch === "{") {
      const wrapper = depth === 0 && /^@layer [a-z]+$/.test(head.trim());
      open.push(wrapper);
      if (wrapper) head = "";
      else {
        if (depth === 0) out.push(head.trim().replace(/\s+/g, " "));
        depth++;
      }
    } else if (ch === "}") {
      if (open.pop()) continue;
      depth--;
      if (depth === 0) head = "";
    } else if (depth === 0) head += ch;
  }
  return out;
}

/** The selectors whose body reads the band's own colours, `--ink` and `--on-ink` (not `--ink-2` or `--on-ink-2`). */
function inkRules(css: string): string[] {
  return rules(css).filter((r) => /var\(--(?:on-)?ink\)/.test(r.body)).map((r) => r.selector);
}

/** Each `border-radius` that is a literal and not a token, as `selector: value`. */
function literalRadii(css: string): string[] {
  return rules(css).flatMap((r) => {
    const value = /border-radius:\s*([^;]+)/.exec(r.body)?.[1]?.trim();
    return value && !value.includes("var(--radius") ? [`${r.selector}: ${value}`] : [];
  });
}

describe("base.css", () => {
  const selectors = topLevelSelectors(readFileSync(new URL("../src/styles/base.css", import.meta.url), "utf8"));

  it("has each rule once, so the cascade does not decide between two copies of it", () => {
    expect(selectors).toContain(".btn-link");
    expect(selectors).toContain(".card.empty");
    const twice = selectors.filter((sel, i) => !sel.startsWith("@") && selectors.indexOf(sel) !== i);
    expect(twice).toEqual([]);
  });

  it("sets a section as a hairline, 16, the heading, 16, the content, 32", () => {
    const css = rules(readFileSync(new URL("../src/styles/base.css", import.meta.url), "utf8"));
    expect(css.find((r) => r.selector === ".card")?.body).toMatch(/padding: var\(--sp-16\) 0 var\(--sp-32\)/);
    expect(css.find((r) => r.selector === ".card-head")?.body).toMatch(/margin: 0 0 var\(--sp-16\)/);
  });

  it("sets the label of a row and the name of a table in the regular weight, and the sum row in the strong one", () => {
    const table = rules(readFileSync(new URL("../src/styles/table.css", import.meta.url), "utf8"));
    expect(table.find((r) => r.selector === '.rt tbody th[scope="row"]')?.body).toMatch(/font-weight: 400/);
    expect(table.find((r) => r.selector === ".rt caption")?.body).toMatch(/font-weight: 400/);
    expect(table.find((r) => r.selector === ".rt tfoot :is(th, td)")?.body).toMatch(/font-weight: 600/);
  });
});

describe("the shared parts and the page stylesheets", () => {
  const sheet = (name: string) => readFileSync(new URL(`../src/styles/${name}.css`, import.meta.url), "utf8");
  const NAMES = [
    "base", "shell", "charts", "settings", "wizard", "banks", "bank-picker", "ops",
    "transactions",
  ];

  it("finds a rule that reads --ink and passes one that reads --ink-2 or --fill", () => {
    const css = ".a { background: var(--ink); } @media (max-width: 9px) { .b { color: var(--on-ink); } } .c { color: var(--ink-2); } .d { color: var(--fill); }";
    expect(inkRules(css)).toEqual([".a", ".b"]);
  });

  it("draws a fill from --fill: --ink and --on-ink stay in the band (its focus ring included) and in the bank tile's ring", () => {
    const perSheet = NAMES.map((n): [string, string[]] => [n, inkRules(sheet(n))]);
    const left = Object.fromEntries(perSheet.filter(([n, selectors]) => n !== "shell" && selectors.length > 0));
    expect(left).toEqual({ "bank-picker": [".bank-tile:hover:not(:disabled) .bank-logo"] });
    expect(inkRules(sheet("shell")).length).toBeGreaterThan(0);
  });

  it("finds a radius that is a literal and passes one that reads a token", () => {
    const css = ".a { border-radius: 6px; } .b { border-radius: var(--radius-s); } .c { border-radius: calc(var(--radius-pill) + 1px); }";
    expect(literalRadii(css)).toEqual([".a: 6px"]);
  });

  it("keeps a literal radius only where it is a mark or a circle: marks, circles and the 10 px boxes", () => {
    const perSheet = NAMES.map((n): [string, string[]] => [n, literalRadii(sheet(n))]);
    const literal = Object.fromEntries(perSheet.filter(([, radii]) => radii.length > 0));
    expect(literal).toEqual({
      base: ['.notice[data-tone="good"]::before: 50%', ".empty-steps li::before: 50%", ".kf-due::after: 50%"],
      charts: [".swatch: 1px", ".line-key: 0", ".tooltip: 10px"],
      banks: [".bank-logo-sm: 5px"],
    });
  });

  it("keeps the foot quieter than the page: muted words, and only the sentence of a fetch in the text colour", () => {
    const all = rules(readFileSync(new URL("../src/styles/marks.css", import.meta.url), "utf8"));
    const foot = all.find((r) => r.selector === ".sheet-foot");
    expect(foot?.body).toContain("color: var(--muted)");
    expect(foot?.body).toContain("border-top: 1px solid var(--border)");
    expect(foot?.body).toContain("margin-top: var(--sp-48)");
    expect(all.find((r) => r.selector === ".sheet-foot [aria-live]")?.body).toContain("color: var(--text-2)");
  });

  it("shows a busy button as a still tint: no animation, no gradient, opacity is the only thing that may move", () => {
    const busy = rules(readFileSync(new URL("../src/styles/base.css", import.meta.url), "utf8")).find((r) => r.selector === '.btn[aria-busy="true"]');
    expect(busy?.body).toContain("var(--row-hover)");
    expect(busy?.body).not.toContain("gradient");
    expect(busy?.body).not.toContain("animation");
  });

  it("makes the segmented keys a thumb's size on a phone", () => {
    const css = readFileSync(new URL("../src/styles/base.css", import.meta.url), "utf8");
    const all = rules(css);
    const key = all.find((r) => r.selector.startsWith(".segmented:not(.topbar .segmented) button"));
    expect(key?.body).toContain("min-height: var(--tap-min)");
    // the margin that takes a link's height back in a cell leaves a segmented key alone, so wrapped keys do not overlap
    const back = all.filter((r) => r.body.includes("margin-block: -0.2rem"));
    expect(back.map((r) => r.selector)).toEqual([":is(td, th, .holding-name, .datum-label) :is(a[href], button:not(.segmented button))"]);
    const coarse: string[] = [];
    for (let at = css.indexOf("@media (pointer: coarse) {"); at >= 0; at = css.indexOf("@media (pointer: coarse) {", at + 1)) {
      let depth = 0;
      let end = css.indexOf("{", at);
      for (let i = end; i < css.length; i++) {
        if (css[i] === "{") depth++;
        else if (css[i] === "}" && --depth === 0) { end = i; break; }
      }
      coarse.push(css.slice(at, end));
    }
    expect(coarse.some((block) => block.includes(".segmented:not(.topbar .segmented) button {"))).toBe(true);
  });
});
