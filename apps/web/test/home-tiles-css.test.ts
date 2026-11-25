import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rules } from "./css-kit.ts";

const css = rules(readFileSync(new URL("../src/styles/home.css", import.meta.url), "utf8"));

describe("the month of Yhteenveto", () => {
  it("stands three across with the last column the widest, and on a phone each figure is a row, its label at the left and the figure at the right", () => {
    const [wide, phone] = css.filter((r) => r.selector === ".home-figs").map((r) => r.body);
    expect(wide).toMatch(/grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\) minmax\(0, 1\.6fr\)/);
    expect(phone).toMatch(/grid-template-columns: minmax\(0, 1fr\);/);
    expect(css.find((r) => r.selector === ".home-figs > li" && /grid-template-columns: minmax\(0, 1fr\) auto/.test(r.body))?.body).toMatch(/align-items: baseline/);
    expect(css.find((r) => r.selector === ".home-figs > li > .fig")?.body).toMatch(/grid-column: 2/);
  });
});
