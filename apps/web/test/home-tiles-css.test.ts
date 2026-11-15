import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rules } from "./css-kit.ts";

const css = rules(readFileSync(new URL("../src/styles/home.css", import.meta.url), "utf8"));
const body = (selector: string) => css.filter((r) => r.selector === selector).map((r) => r.body).join(" ");

describe("the month of Yhteenveto", () => {
  it("stands three across with Tulos the widest and the largest, and one under the other on a phone", () => {
    expect(body(".home-figs")).toMatch(/grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\) minmax\(0, 1\.6fr\)/);
    expect(body(".home-figs")).toMatch(/grid-template-columns: minmax\(0, 1fr\)(;|$)/);
    expect(body('.home-figs > li[data-fig="result"] .fig-l')).toMatch(/font-size: var\(--fs-display\)/);
  });
});
