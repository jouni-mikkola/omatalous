import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { size as SIZE } from "../src/design/tokens.ts";
import { rules } from "./css-kit.ts";

// The tab row of Raportit scrolls sideways, so it clips whatever is drawn outside its padding box. The ring of a focused
// tab has to sit inside the link, off the text, and the open tab's underline is the width of a ring (2 px).

const css = readFileSync(new URL("../src/styles/reports.css", import.meta.url), "utf8");
const all = rules(css);

/** The value a rule's body gives a property, or undefined. */
const value = (body: string, property: string): string | undefined =>
  body.split(";").map((d) => d.split(":")).find((d) => d[0]!.trim() === property)?.slice(1).join(":").trim();

const of = (selector: string) => all.find((r) => r.selector === selector);

describe("the tabs of Raportit", () => {
  it("clip sideways, so the focus ring sits inside the link", () => {
    expect(value(of(".q-tabs")!.body, "overflow-x")).toBe("auto");
    const offset = value(of(".q-list a:focus-visible")!.body, "outline-offset");
    expect(offset?.replace(/calc\(var\(--ring\) \* -1\)/, `-${SIZE.ring}px`)).toMatch(/^-\d+px$/);
  });

  it("have padding at the sides, so the ring does not touch the text", () => {
    const padding = value(of(".q-list a")!.body, "padding")!.split(/\s+/);
    expect(padding.length).toBe(1);
    expect(padding[0]).toMatch(/^var\(--sp-\d+\)$/);
  });

  it("underline the open tab 2 px wide in the accent colour", () => {
    expect(value(of(".q-list a")!.body, "border-bottom")).toBe("var(--ring) solid transparent");
    expect(SIZE.ring).toBe(2);
    expect(value(of(".q-list a[aria-current]")!.body, "border-bottom-color")).toBe("var(--accent)");
    // the row clips below its padding box, so a negative margin would hide 1 px of the line
    expect(value(of(".q-list a")!.body, "margin-bottom")).toBeUndefined();
  });

  it("reserve no width for the period switch: it is a sibling in the row, not laid over the tabs", () => {
    expect(css).not.toMatch(/position:\s*absolute/);
    expect(css).not.toMatch(/padding-inline-end:\s*34rem/);
    const wide = of(".q-bar .q-tabs")!.body;
    expect(value(wide, "flex")).toBe("1 1 0");
    expect(value(wide, "min-inline-size")).toBe("0");
  });
});
