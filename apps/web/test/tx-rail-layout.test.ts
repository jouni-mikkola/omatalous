import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = (name: string) => readFileSync(new URL(`../src/styles/${name}`, import.meta.url), "utf8");

describe("Tapahtumat and the rail at 1000 px and on a wide screen", () => {
  it("draws the rail as one row from 1100 px, where the view switch and the review count fit, and hides the user's small text under 1100 px", () => {
    const c = css("shell.css");
    expect(c).toMatch(/@media \(min-width: 641px\) and \(max-width: 1099px\) \{\s*\.topbar-in \{ height: auto; flex-wrap: wrap/);
    expect(c).toMatch(/@media \(max-width: 1099px\) \{ \.user-menu summary \.small \{ display: none; \} \}/);
    expect(c).not.toMatch(/two rows|do not fit beside the switch: they take a row of their own under the first \*\/\n@media \(min-width: 641px\) and \(max-width: 1099px\)/);
  });
});

describe("the view switch in the rail", () => {
  it("never wraps its two labels", () => {
    expect(css("shell.css")).toMatch(/\.topbar \.segmented \{[^}]*flex: none; white-space: nowrap;/);
  });
});
