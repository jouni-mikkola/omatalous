import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");
const doc = readFileSync(join(root, "docs", "MONEY_FLOWS.md"), "utf8");

describe("docs/MONEY_FLOWS.md", () => {
  it("names no analysis file that is gone", () => {
    const named = [...new Set([...doc.matchAll(/`(analysis\/[a-z0-9-]+\.ts)`/g)].map((m) => m[1]!))];
    const gone = named.filter((f) => !existsSync(join(root, "packages", "core", "src", f)));
    expect(gone).toEqual([]);
  });

  it("has no section for the deleted notices and long forecast", () => {
    expect(doc).not.toMatch(/^## (Coverage notices|Longer forecast)$/m);
  });

  it("tells the questions share as twelve months of spending with five kinds", () => {
    expect(doc).toContain("`knownSpending`");
    expect(doc).toContain("five kinds");
    expect(doc).toContain("`plan`:");
  });
});
