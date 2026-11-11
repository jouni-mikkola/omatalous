import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

/** The six tabs of Asetukset, as the app labels them. */
const TABS = ["Pankit ja tilit", "Talous", "Jäsenet", "Turvallisuus", "Tiedot", "Palvelin ja ylläpito"];

/** The cards the guide names, each under the tab that shows it. */
const CARDS: Record<string, string> = {
  Ylläpito: "Palvelin ja ylläpito",
  Palvelin: "Palvelin ja ylläpito",
  Pankkisovellus: "Pankit ja tilit",
  Pankkiyhteydet: "Pankit ja tilit",
  Tilit: "Pankit ja tilit",
  Lainat: "Talous",
  "Talouden jäsenet": "Jäsenet",
};

/** The guide with each line end read as a space, so a path that wraps over a line end is one path. */
const guide = readFileSync(join(import.meta.dirname, "../../docs/TROUBLESHOOTING.md"), "utf8").replace(/\s+/g, " ");

/** Every path the guide gives into Asetukset: the names after `Asetukset > `, up to the closing `*`. */
const paths = [...guide.matchAll(/Asetukset > ([^*]+)\*/g)].map((m) => m[1]!.split(" > "));

test("the guide points into Asetukset", () => {
  expect(paths.length).toBeGreaterThan(0);
  expect(paths.length).toBe(guide.split("Asetukset > ").length - 1);
});

test("the name after Asetukset is one of the six tabs", () => {
  for (const [tab] of paths) expect(TABS).toContain(tab!);
});

test("a card follows the tab that shows it", () => {
  for (const [tab, card, ...rest] of paths) {
    if (card === undefined) continue;
    expect(rest).toEqual([]);
    expect({ card, tab: CARDS[card] }).toEqual({ card, tab: tab! });
  }
});

test("the guide names each card under its tab", () => {
  const named = new Set(paths.map(([, card]) => card));
  for (const card of Object.keys(CARDS)) expect(named).toContain(card);
});
