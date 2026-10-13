import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** The selectors of base.css's top-level rules, in file order (a `@media` block counts as one rule, by its query). */
function topLevelSelectors(css: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let head = "";
  for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (ch === "{") {
      if (depth === 0) out.push(head.trim().replace(/\s+/g, " "));
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) head = "";
    } else if (depth === 0) head += ch;
  }
  return out;
}

/** Every rule with a body, innermost first, as its selector and its declarations (an `@media` wrapper is not a rule). */
function rules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: m[1]!.trim().replace(/\s+/g, " "), body: m[2]!.trim() });
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
    expect(selectors).toContain(".link-btn");
    expect(selectors).toContain(".empty-start");
    const twice = selectors.filter((sel, i) => !sel.startsWith("@") && selectors.indexOf(sel) !== i);
    expect(twice).toEqual([]);
  });
});

describe("the shared parts and the page stylesheets that read both looks", () => {
  const sheet = (name: string) => readFileSync(new URL(`../src/styles/${name}.css`, import.meta.url), "utf8");
  const NAMES = [
    "base", "shell", "charts", "settings", "wizard", "banks", "bank-picker", "optimise", "month", "ops", "remote-access",
    "transactions",
  ];

  it("finds a rule that reads --ink and passes one that reads --ink-2 or --fill", () => {
    const css = ".a { background: var(--ink); } @media (max-width: 9px) { .b { color: var(--on-ink); } } .c { color: var(--ink-2); } .d { color: var(--fill); }";
    expect(inkRules(css)).toEqual([".a", ".b"]);
  });

  it("draws a fill from --fill: --ink and --on-ink stay in the band (its focus ring included) and in the bank tile's ring", () => {
    const perSheet = NAMES.map((n): [string, string[]] => [n, inkRules(sheet(n))]);
    const left = Object.fromEntries(perSheet.filter(([n, selectors]) => n !== "shell" && selectors.length > 0));
    expect(left).toEqual({ base: [".topbar :focus-visible"], "bank-picker": [".bank-tile:hover:not(:disabled) .bank-logo"] });
    expect(inkRules(sheet("shell")).length).toBeGreaterThan(0);
  });

  it("finds a radius that is a literal and passes one that reads a token", () => {
    const css = ".a { border-radius: 6px; } .b { border-radius: var(--radius-s); } .c { border-radius: calc(var(--radius-pill) + 1px); }";
    expect(literalRadii(css)).toEqual([".a: 6px"]);
  });

  it("keeps a literal radius only where both looks give the same value: marks, circles and the 10 px boxes", () => {
    const perSheet = NAMES.map((n): [string, string[]] => [n, literalRadii(sheet(n))]);
    const literal = Object.fromEntries(perSheet.filter(([, radii]) => radii.length > 0));
    expect(literal).toEqual({
      base: [".card:not(.skeleton)::before, dialog.confirm::before: inherit", ".notice.good::before: 50%"],
      charts: [".swatch: 1px", ".line-key: 0", ".tooltip: 10px"],
      banks: [".bank-logo-sm: 5px"],
      month: [".bridge-from: 4px"],
      ops: [".ops-command: 4px"],
    });
  });
});
