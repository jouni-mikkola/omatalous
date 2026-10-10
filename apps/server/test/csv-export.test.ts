import { describe, expect, it } from "vitest";
import { csv } from "../src/routes/shared.ts";

describe("csv()", () => {
  it("writes Excel-friendly Finnish CSV", () => {
    const out = csv([["Nimi", "Summa"], ["Kahvila; Oy", 12.5], ['Sanoi "moi"', null]]);
    expect(out.startsWith("﻿")).toBe(true);
    expect(out).toContain('"Kahvila; Oy";12,5');
    expect(out).toContain('"Sanoi ""moi""";');
  });

  it("neutralises spreadsheet formulas in text cells", () => {
    expect(csv([["=HYPERLINK(\"x\")", "+1", "-2", "@cmd"]])).toContain("'=HYPERLINK");
    expect(csv([["+1"]])).toContain("'+1");
    expect(csv([[-2]])).toContain("-2"); // numbers stay numbers
  });
});
