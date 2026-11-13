import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rules } from "./css-kit.ts";

const css = rules(readFileSync(new URL("../src/styles/home.css", import.meta.url), "utf8"));
const body = (selector: string) => css.filter((r) => r.selector === selector).map((r) => r.body).join(" ");

describe("the tiles of Yhteenveto", () => {
  it("stand four across and two by two on a phone", () => {
    expect(body(".home-tiles")).toMatch(/grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
    expect(body(".home-tiles")).toMatch(/grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  });

  // the tile that opens its rows' panel is a button (`why-door`, with no `why-fig`): it wore the browser's grey box and outset border
  it("draw the button tile as the links beside it", () => {
    expect(body("button.home-tile")).toMatch(/border: 0/);
    expect(body("button.home-tile")).toMatch(/background: none/);
  });
});
