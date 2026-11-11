import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rules } from "./css-kit.ts";

const css = rules(readFileSync(new URL("../src/styles/shell.css", import.meta.url), "utf8"));

describe("the count of Tarkistettavat in the phone's tab bar", () => {
  // 2 px from the bar's top edge and from the screen's edge, the count looked stuck on the bar's rim rather than on its tab.
  it("stands clear of the bar's top edge and of the screen's edge", () => {
    const body = css.find((r) => r.selector === ".nav .review-link .nav-count")?.body ?? "";
    expect(body).toMatch(/top: var\(--sp-4\)/);
    expect(body).toMatch(/right: var\(--sp-4\)/);
  });
});
