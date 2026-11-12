import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rules } from "./css-kit.ts";

const css = readFileSync(new URL("../src/styles/toolbar.css", import.meta.url), "utf8");
const search = rules(css).filter((r) => r.selector === ".rtb-search");

describe("the search box of a table's toolbar", () => {
  it("gives way before the row wraps: a wrapping row counts it by its 12rem basis, and it grows to 20rem at most", () => {
    expect(search[0]?.body).toMatch(/flex: 1 1 12rem;/);
    expect(search[0]?.body).toMatch(/max-inline-size: 20rem;/);
  });

  it("takes the whole row on a phone", () => {
    expect(search[1]?.body).toMatch(/flex: 1 1 100%;/);
    expect(search[1]?.body).toMatch(/max-inline-size: none;/);
  });
});
