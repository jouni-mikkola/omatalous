import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const GUIDE = readFileSync(join(import.meta.dirname, "../../docs/ENABLE_BANKING.md"), "utf8");
/** The six tab labels the guide may name after Asetukset. */
const TABS = ["Pankit ja tilit", "Talous", "Jäsenet", "Turvallisuus", "Tiedot", "Palvelin ja ylläpito"];
/** The two cards of Pankit ja tilit the guide used to name as tabs. */
const CARDS = ["Pankkiyhteydet", "Tilit"];

/** The parts of each *Asetukset > ...* the guide writes: the tab first, then the card and what is on it. */
function paths(text: string): string[][] {
  return [...text.matchAll(/\*Asetukset\s*>\s*([^*]+)\*/g)].map((m) => m[1]!.split(">").map((p) => p.replace(/\s+/g, " ").trim()));
}

describe("docs/ENABLE_BANKING.md names the tabs of Asetukset", () => {
  it("writes every Asetukset as an emphasised path, so each one is read here", () => {
    expect(paths(GUIDE).length).toBe(GUIDE.split("Asetukset").length - 1);
  });

  it("names one of the six tabs after each Asetukset >", () => {
    expect(paths(GUIDE).filter((p) => !TABS.includes(p[0]!)).map((p) => p.join(" > "))).toEqual([]);
  });

  it("names the cards Pankkiyhteydet and Tilit after their tab Pankit ja tilit", () => {
    for (const card of CARDS) {
      const under = paths(GUIDE).filter((p) => p[0] === "Pankit ja tilit" && p[1] === card);
      expect(under.length, card).toBeGreaterThan(0);
    }
  });
});
