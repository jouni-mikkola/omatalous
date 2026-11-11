import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rules } from "./css-kit.ts";

const css = rules(readFileSync(new URL("../src/styles/report-month.css", import.meta.url), "utf8"));

describe("the month arrows of Kuukausi", () => {
  // They were 32 px glyphs of body size in a muted grey with no edge, easy to miss as the way into earlier months.
  it("are buttons with an edge, a finger's size and a glyph as large as the month's name", () => {
    const body = css.find((r) => r.selector === ".km-head .btn-icon")?.body ?? "";
    expect(body).toMatch(/min-inline-size: var\(--tap-min\)/);
    expect(body).toMatch(/border: 1px solid var\(--border\)/);
    expect(body).toMatch(/font-size: var\(--fs-title\)/);
  });
});
