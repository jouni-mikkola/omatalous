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

  it("writes no NaN, Infinity or exponent", () => {
    expect(csvBody([[NaN, Infinity, -Infinity]])).toBe(";;\r\n");
    expect(csvBody([[1e21]])).toBe("1000000000000000000000\r\n");
    expect(csvBody([[0.0000001]])).toBe("0,0000001\r\n");
    expect(csvBody([[1.5, 0, -0, "abc"]])).toBe("1,5;0;0;abc\r\n");
  });
});
