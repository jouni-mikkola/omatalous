import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = new URL("../src/pages/settings/", import.meta.url);

/** A Finnish sentence written in the code ("Yhteys poistettu."), outside comments: the English page showed it as it was. */
const literals = (src: string): string[] =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .flatMap((line) => [...line.matchAll(/"([A-ZÄÖ][a-zäö]+(?: [a-zäö]+)*\.)"/g)].map((m) => m[1]!));

describe("Asetukset: the confirmations of a change", () => {
  it("are messages of the catalogue, so they follow the language of the page", () => {
    const found = readdirSync(dir)
      .filter((f) => f.endsWith(".tsx"))
      .flatMap((f) => literals(readFileSync(new URL(f, dir), "utf8")).map((text) => `${f}: ${text}`));
    expect(found).toEqual([]);
  });
});
