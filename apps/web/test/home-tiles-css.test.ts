import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rules } from "./css-kit.ts";

const css = rules(readFileSync(new URL("../src/styles/home.css", import.meta.url), "utf8"));

describe("the month of Yhteenveto", () => {
  it("stands three across with Tulos the widest, and on a phone Tulot and Menot side by side with Tulos under them", () => {
    const [wide, phone] = css.filter((r) => r.selector === ".home-figs").map((r) => r.body);
    expect(wide).toMatch(/grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\) minmax\(0, 1\.6fr\)/);
    expect(phone).toMatch(/grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 9rem\), 1fr\)\)/);
    expect(css.find((r) => r.selector === '.home-figs > li[data-fig="result"]')?.body).toMatch(/grid-column: 1 \/ -1/);
  });
});
