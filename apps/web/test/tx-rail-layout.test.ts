import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = (name: string) => readFileSync(new URL(`../src/styles/${name}`, import.meta.url), "utf8");

describe("Tapahtumat and the rail at 1000 px and on a wide screen", () => {
  it("gives a name in the uncategorised list a measure and puts the sums on one right edge", () => {
    const c = css("transactions.css");
    expect(c).toMatch(/\.uncat-list li \{ display: grid; grid-template-columns: minmax\(0, 20rem\) 7rem minmax\(0, 13rem\); justify-content: start;/);
    expect(c).toMatch(/\.uncat-list \.num \{[^}]*text-align: right;/);
  });
  it("keeps Alkaen and Asti on the row of the other filters between 961 and 1123 px", () => {
    expect(css("transactions.css")).toMatch(/min-width: 961px\) \{ \.tx-page \.filters select \{ max-width: 11rem; \}/);
  });
  it("draws the rail as one row from 990 px and hides the user's small text under 1100 px", () => {
    const c = css("shell.css");
    expect(c).toMatch(/@media \(min-width: 641px\) and \(max-width: 989px\) \{\s*\.topbar-in \{ height: auto; flex-wrap: wrap/);
    expect(c).toMatch(/@media \(max-width: 1099px\) \{ \.user-menu summary \.small \{ display: none; \} \}/);
    expect(c).not.toMatch(/two rows|do not fit beside the switch: they take a row of their own under the first \*\/\n@media \(min-width: 641px\) and \(max-width: 1099px\)/);
  });
});

describe("the view switch in the rail", () => {
  it("never wraps its two labels", () => {
    expect(css("shell.css")).toMatch(/\.topbar \.segmented \{[^}]*flex: none; white-space: nowrap;/);
  });
});
