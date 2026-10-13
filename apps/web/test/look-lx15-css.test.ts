import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = (name: string) => readFileSync(new URL(`../src/styles/${name}`, import.meta.url), "utf8");
const src = (name: string) => readFileSync(new URL(`../src/pages/settings/${name}`, import.meta.url), "utf8");

describe("Säästövinkit and Asetukset: the lines left by the audits", () => {
  it("keeps a needed input's label, field and key together", () => {
    const c = css("optimise.css");
    expect(c).toMatch(/\.needed \{[^}]*justify-content: flex-start;/);
    expect(c).toMatch(/\.needed > \.needed-text \{ flex: 0 1 20rem; \}/);
  });
  it("gives the sentence of a joint account a measure and draws no lone dash under an account", () => {
    expect(css("settings.css")).toMatch(/\.use-line > span \{ max-width: 70ch; text-wrap: pretty; \}/);
    expect(src("Accounts.tsx")).not.toMatch(/accountNumber\(a\) \|\| "–"/);
  });
  it("gives the members' columns measures from 1600 px only", () => {
    const c = css("settings.css");
    expect(src("Members.tsx")).toContain("members-table");
    expect(c).toMatch(/min-width: 1600px\) \{\s*\.members-table \{ table-layout: fixed; \}/);
    expect(c).not.toMatch(/^\.members-table/m);
  });
});
