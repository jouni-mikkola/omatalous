import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "../lib/tmp-kit.ts";
import { build, CSS_OUT, render, SOURCE } from "./build.ts";
import { oklchToHex, readTokens } from "./dtcg.ts";

const ROOT = join(import.meta.dirname, "../..");
const WEB = join(ROOT, "apps/web/src");

/** The stylesheets of the web app (the private pages' too) and their text. */
function sheets(): [string, string][] {
  return (readdirSync(WEB, { recursive: true }) as string[]).filter((f) => f.endsWith(".css")).sort().map((f) => [f, readFileSync(join(WEB, f), "utf8")]);
}

const colour = (l: number, c = 0, h = 0) => ({ $type: "color", $value: { colorSpace: "oklch", components: [l, c, h] } });

describe("pnpm tokens", () => {
  it("has the generated files equal to apps/web/design/tokens.json", () => {
    expect(build(ROOT, true), "run `pnpm tokens` and commit the result").toEqual([]);
  });

  it("finds a generated file that was changed by hand or a source that was changed without running it", () => {
    const root = tempDir("tokens-test-");
    for (const f of [SOURCE, CSS_OUT, "apps/web/src/design/tokens.ts"]) {
      mkdirSync(join(root, f, ".."), { recursive: true });
      cpSync(join(ROOT, f), join(root, f));
    }
    expect(build(root, true)).toEqual([]);
    writeFileSync(join(root, CSS_OUT), readFileSync(join(root, CSS_OUT), "utf8").replace("--page:", "--pagE:"));
    expect(build(root, true)).toEqual([CSS_OUT]);
    const source = JSON.parse(readFileSync(join(root, SOURCE), "utf8"));
    source.color.page.$value.components[0] = 0.5;
    writeFileSync(join(root, SOURCE), JSON.stringify(source));
    expect(build(root, true).sort()).toEqual([CSS_OUT, "apps/web/src/design/tokens.ts"].sort());
    expect(build(root, false).length).toBe(2);
    expect(build(root, true)).toEqual([]);
  });

  it("writes one look: one set of colours, no light-dark(), no second scheme", () => {
    const css = readFileSync(join(ROOT, CSS_OUT), "utf8").replace(/\/\*[\s\S]*?\*\//, "");
    expect(css.match(/^ *:root/gm)?.length).toBeGreaterThanOrEqual(1);
    expect(css).not.toMatch(/light-dark\(|prefers-color-scheme|data-look/);
    expect(css).toContain("color-scheme: light;");
  });

  it("holds at most two shadows, and the type scale of 13, 15, 20 and 32 with one line height each", () => {
    const tokens = readTokens(JSON.parse(readFileSync(join(ROOT, SOURCE), "utf8")));
    expect(tokens.filter((t) => t.type === "shadow").length).toBeLessThanOrEqual(2);
    expect(tokens.filter((t) => t.key.startsWith("fs-")).map((t) => (t.value as { value: number }).value)).toEqual([13, 15, 20, 32]);
    expect(tokens.filter((t) => t.key.startsWith("lh-")).length).toBe(4);
  });
});

describe("the spacing scale", () => {
  it("is the steps 4, 8, 16, 24 and 40: every sp-* token is a multiple of 4 and a stylesheet reads a step or an older name that base.css maps to one", () => {
    const tokens = readTokens(JSON.parse(readFileSync(join(ROOT, SOURCE), "utf8")));
    const steps = tokens.filter((t) => t.key.startsWith("sp-"));
    expect(steps.map((t) => (t.value as { value: number }).value)).toEqual([4, 8, 16, 24, 40]);
    for (const t of steps) expect((t.value as { value: number }).value % 4, t.key).toBe(0);
    const older = [...readFileSync(join(WEB, "styles/base.css"), "utf8").matchAll(/(--sp-\d+): var\(--sp-\d+\);/g)].map((m) => m[1]!);
    const known = new Set([...steps.map((t) => `--${t.key}`), ...older]);
    const used = sheets().flatMap(([f, css]) => [...css.matchAll(/var\((--sp-\d+)\)/g)].map((m) => [f, m[1]!] as const));
    expect(used.filter(([, name]) => !known.has(name))).toEqual([]);
  });
});

describe("the DTCG reader", () => {
  it("turns a colour in OKLCH into #rrggbb", () => {
    expect(oklchToHex({ colorSpace: "oklch", components: [1, 0, 0] })).toBe("#ffffff");
    expect(oklchToHex({ colorSpace: "oklch", components: [0, 0, 0] })).toBe("#000000");
  });

  it("refuses a missing type, a key used twice, an alias to nothing, a colour outside sRGB and a duration with no unit, naming each", () => {
    const file = {
      color: { $type: "color", a: colour(0.5), b: colour(0.5, 0.4, 140), c: { $value: "{color.nope}" } },
      other: { a: { $type: "duration", $value: 100 }, d: { $value: 3 } },
    };
    expect(() => readTokens(file)).toThrow(/other\.a: a duration is[\s\S]*other\.d: unknown or missing \$type[\s\S]*color\.b: oklch\(0\.5 0\.4 140\) is outside sRGB|color\.c: the alias \{color\.nope\} names no token/);
    try {
      readTokens(file);
    } catch (e) {
      const text = String(e);
      for (const part of ['the key "a" is also color.a', "color.b: oklch(0.5 0.4 140) is outside sRGB", "color.c: the alias {color.nope} names no token", "other.d: unknown or missing $type", "other.a: a duration is"]) expect(text).toContain(part);
    }
  });

  it("reads a good file and lists the tokens in file order", () => {
    const tokens = readTokens({ color: { $type: "color", one: colour(0.2), two: colour(0.9, 0.05, 250) }, size: { $type: "dimension", pad: { $value: { value: 8, unit: "px" } } } });
    expect(tokens.map((t) => t.key)).toEqual(["one", "two", "pad"]);
    expect(Object.keys(render(ROOT)).sort()).toEqual([CSS_OUT, "apps/web/src/design/tokens.ts"].sort());
  });
});

describe("the stylesheets", () => {
  it("declare the layers once, in base.css, in the order reset, tokens, base, components, pages, utilities", () => {
    const declared = sheets().filter(([, css]) => /@layer reset, tokens, base, components, pages, utilities;/.test(css)).map(([f]) => f);
    expect(declared).toEqual(["styles/base.css"]);
  });

  it("put every rule in a layer: each sheet is one @layer block, and a rule outside a layer would beat all of them", () => {
    const outside = sheets().flatMap(([f, css]) => {
      const text = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@layer reset, tokens[^;]*;/, "").trim();
      const first = /^@layer (reset|tokens|base|components|pages|utilities) \{/.exec(text);
      return first && text.endsWith("}") ? [] : [f];
    });
    expect(outside).toEqual([]);
  });

  it("know no second look: no light-dark(), no prefers-color-scheme, no data-look", () => {
    const found = sheets().filter(([, css]) => /light-dark\(|prefers-color-scheme|data-look/.test(css.replace(/\/\*[\s\S]*?\*\//g, ""))).map(([f]) => f);
    expect(found).toEqual([]);
  });

  it("read only custom properties that some sheet or script defines (a token that was renamed is found here)", () => {
    const defined = new Set<string>();
    const used = new Map<string, string>();
    const files = (readdirSync(WEB, { recursive: true }) as string[]).filter((f) => /\.(css|tsx?)$/.test(f) && !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));
    for (const f of files) {
      const text = readFileSync(join(WEB, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const m of text.matchAll(/(?<![\w-])(--[a-z0-9-]+)\s*:/g)) defined.add(m[1]!);
      for (const m of text.matchAll(/["'`](--[a-z0-9-]+)["'`]/g)) defined.add(m[1]!);
      for (const m of text.matchAll(/var\((--[a-z0-9-]+)\s*[,)]/g)) if (!used.has(m[1]!)) used.set(m[1]!, f);
    }
    const missing = [...used].filter(([name]) => !defined.has(name)).map(([name, f]) => `${name} in ${f}`);
    expect(missing).toEqual([]);
  });
});
