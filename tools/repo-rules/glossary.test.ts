import { describe, expect, it } from "vitest";
import { REMOVED, removedIn } from "./glossary.ts";

// One text that uses the removed word, and near misses that must pass.
const CASES: Record<string, { bad: string[]; ok: string[] }> = {
  Optimoi: {
    bad: ["Optimoi", "Optimoi-sivun päätökset", "Voit optimoida kulut", "Optimointi"],
    ok: ["Säästövinkit", "Säästövinkkien lähtötiedot"],
  },
  "Yli jäi": {
    bad: ["Yli jäi", "Yli jäi viime kuussa", "Kuun lopussa. yli jäi 120 €"],
    ok: ["Tulos viime kuussa", "Jäi yli 120 €", "Ylijäämä"],
  },
  "Tileillä as a figure name": {
    bad: ["Tileillä", "Tileillä yhteensä", "Tileillä ${money(total)}"],
    ok: ["Tilien saldo", "Tilien saldo riittää 3 kuukauden menoihin.", "Tileillä olevat rahat riittävät kolmeksi kuukaudeksi, kun menot pysyvät samana.", "Rahaa tileillä"],
  },
  Linkitä: {
    bad: ["Linkitä tili Enable Bankingissa.", "Tili on linkitetty", "Ylläpitäjä linkittää tilin", "Ei linkitetty"],
    ok: ["Lisää tili Enable Bankingissa (Link accounts).", 'Paina painiketta "Linkitä tili".', "Kopioi linkki ja avaa kaikki linkit.", "Yhdistä pankki"],
  },
};

describe("rule 35: the words the glossary removed", () => {
  it("has a case for every word, and no case for a word that is gone", () => {
    expect(Object.keys(CASES).sort()).toEqual(REMOVED.map((r) => r.name).sort());
  });

  for (const r of REMOVED) {
    it(`${r.name}: finds its texts and passes its near misses`, () => {
      const { bad, ok } = CASES[r.name]!;
      for (const t of bad) expect(removedIn(t).map((x) => x.name), t).toContain(r.name);
      for (const t of ok) expect(removedIn(t).map((x) => x.name), t).not.toContain(r.name);
    });
  }

  it("takes a quotation of another service's own word, and only a quotation", () => {
    expect(removedIn('Paina "Linkitä" ja valitse tili.')).toEqual([]);
    expect(removedIn('Paina "Linkitä" ja linkitä tili.').map((x) => x.name)).toEqual(["Linkitä"]);
  });
});
