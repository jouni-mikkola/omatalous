import { describe, expect, it } from "vitest";
import { csv, csvBody } from "../src/csv.ts";

describe("csv", () => {
  it("writes Finnish spreadsheet CSV: semicolons, a decimal comma, a BOM", () => {
    expect(csv([["Nimi", "Summa"], ["Kahvila; Oy", 12.5], ['Sanoi "moi"', null]])).toBe('﻿Nimi;Summa\r\n"Kahvila; Oy";12,5\r\n"Sanoi ""moi""";\r\n');
  });

  it("keeps the BOM out of a body written in pieces", () => {
    expect(csvBody([["a"]])).toBe("a\r\n");
  });

  it("makes a text cell that starts like a formula plain text, and leaves numbers alone", () => {
    expect(csv([["=1+1", "+1", "-2", "@x"]])).toContain("'=1+1;'+1;'-2;'@x");
    expect(csv([[-2]])).toContain("-2");
  });
});
