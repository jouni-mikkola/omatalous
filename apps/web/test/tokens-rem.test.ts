import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as tokens from "../src/design/tokens.ts";

// Decision: whether a household that sets a larger text size in the browser gets a larger page. Type, line heights and
// spacing are in rem, so they follow that setting; a touch target stays in px so it is never smaller than a finger.
const SRC = new URL("../src/", import.meta.url);
const css = readFileSync(new URL("styles/tokens.css", SRC), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every declaration of a custom property in tokens.css, the ones under a media query too, as name and value. */
const declared = [...css.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m): [string, string] => [m[1]!, m[2]!.trim()]);
const named = (pattern: RegExp) => declared.filter(([name]) => pattern.test(name));

describe("the tokens that scale with the browser's text size", () => {
  it("has every type size, line height and step of space in rem", () => {
    const own = named(/^--(fs-(?!dec$)[a-z0-9-]+|lh-[a-z0-9-]+|sp-\d+|pad|gap|mark-gap)$/);
    expect(own.length).toBeGreaterThan(20);
    expect(own.filter(([, value]) => !/^[\d.]+rem$/.test(value))).toEqual([]);
  });

  it("has the heights of the header, the tab bar, a row and a control in rem", () => {
    const own = named(/^--(rail-h|tabbar-h|row-h)$/);
    expect(own.map(([name]) => name)).toEqual(["--rail-h", "--tabbar-h", "--row-h"]);
    expect(own.filter(([, value]) => !/^[\d.]+rem$/.test(value))).toEqual([]);
    expect(declared.find(([name]) => name === "--control-h")?.[1]).toBe("2rem");
  });

  it("keeps a touch target in px: 44 px for a thumb, 24 px as the floor, and a control is at least 44 px where the pointer is a finger, and grows with the text", () => {
    const px = (name: string) => declared.filter(([n]) => n === name).map(([, value]) => value);
    expect(px("--tap-min")).toEqual(["44px"]);
    expect(px("--tap-floor")).toEqual(["24px"]);
    expect(px("--row-h-roomy")).toEqual(["44px"]);
    expect(px("--control-h")).toEqual(["2rem", "max(44px, 2rem)"]);
  });

  it("gives code the same sizes in px as before, 16 px to the rem", () => {
    expect(tokens.fontSize).toMatchObject({ label: 12, small: 14, body: 16, h2: 20, "fig-m": 24, "fig-l": 32, display: 52 });
    expect(tokens.space).toEqual({ 4: 4, 8: 8, 12: 12, 16: 16, 20: 20, 24: 24, 32: 32, 48: 48 });
    expect(tokens.size).toMatchObject({ pad: 24, gap: 16, "rail-h": 48, "tabbar-h": 56, "row-h": 32, "control-h": 32, "tap-min": 44 });
  });

  it("sets the size of the root in no stylesheet, so the browser's own size is the rem", () => {
    const sheets = (readdirSync(SRC, { recursive: true }) as string[]).filter((f) => f.endsWith(".css") && f !== "styles/fonts.css");
    const roots = sheets.flatMap((f) =>
      [...readFileSync(new URL(f, SRC), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(?:^|[}\s,])(?:html|:root)\s*\{([^{}]*)\}/g)]
        .filter((m) => /(?:^|[;\s])font-size\s*:/.test(m[1]!))
        .map(() => f),
    );
    expect(roots).toEqual([]);
  });
});
