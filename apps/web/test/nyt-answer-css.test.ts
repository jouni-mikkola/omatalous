import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rules } from "./css-kit.ts";

const css = rules(readFileSync(new URL("../src/styles/home.css", import.meta.url), "utf8"));

describe("the answer line of Nyt", () => {
  // Pushed to the far edge, the sum stood about 1 100 px from "Palkkapäivään 25.11. jää" at 1440 px.
  it("puts the sum right after its question", () => {
    const body = css.find((r) => r.selector === ".home-answer-line")?.body ?? "";
    expect(body).toMatch(/justify-content: flex-start/);
    expect(body).not.toMatch(/space-between/);
  });
});
