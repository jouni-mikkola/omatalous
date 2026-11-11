import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The six tab labels of Asetukset this step was given, each with the headings of the cards that come straight after it.
 * The list is written here and not read from the app: step T74 cuts Asetukset to three tabs, and step D6 then moves the
 * guides to those and replaces this test with one that reads the app's labels.
 * A name deeper in a path (Etäkäyttö inside Palvelin, a button) is not a card of the tab and is not listed.
 */
const TABS: Record<string, string[]> = {
  "Pankit ja tilit": ["Pankkiyhteydet", "Pankkisovellus", "Tilit", "Tiliote tiedostosta", "Pankkihaut"],
  Talous: ["Lainat"],
  Jäsenet: ["Talouden jäsenet"],
  Turvallisuus: [],
  Tiedot: ["Esimerkkitiedot"],
  "Palvelin ja ylläpito": ["Palvelin", "Ylläpito"],
};

/** The guide with each line end read as a space, so a label that wraps over a line end is one label. */
const GUIDE = readFileSync(join(import.meta.dirname, "../../docs/INSTALL.md"), "utf8").replace(/\s+/g, " ");

/** Every path the guide writes as `*Asetukset > tab > card*`, cut at the ` > `. */
function paths(text: string): string[][] {
  return [...text.matchAll(/\*Asetukset > ([^*]+)\*/g)].map((m) => m[1]!.split(" > "));
}

describe("docs/INSTALL.md, the tabs of Asetukset", () => {
  it("writes every path under Asetukset in one emphasis the test can read", () => {
    expect(paths(GUIDE).length).toBeGreaterThan(0);
    expect(paths(GUIDE).length).toBe(GUIDE.split("Asetukset > ").length - 1);
  });

  it("names one of the six tabs after each Asetukset >", () => {
    expect(Object.keys(TABS)).toHaveLength(6);
    expect(paths(GUIDE).filter(([tab]) => !(tab! in TABS)).map((p) => p.join(" > "))).toEqual([]);
  });

  it("reads a tab label that wraps over a line end", () => {
    expect(paths("see (*Asetukset > Pankit ja tilit*) now".replace(/\s+/g, " "))).toEqual([["Pankit ja tilit"]]);
    expect(paths("see (*Asetukset > Pankit ja\ntilit*) now".replace(/\s+/g, " "))).toEqual([["Pankit ja tilit"]]);
  });

  it("names a card by its heading, after the tab the card is on", () => {
    const wrong = paths(GUIDE).filter(([tab, card]) => card !== undefined && !(TABS[tab!] ?? []).includes(card));
    expect(wrong.map((p) => p.join(" > "))).toEqual([]);
  });
});
