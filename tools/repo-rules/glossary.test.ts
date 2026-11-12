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
  Vaihteluväli: {
    bad: ["Odotettu vaihteluväli", "Vaihteluvälin ylä"],
    ok: ["Tavallisesti 2 700–3 260 €", "Vaihtelu on suurta"],
  },
  Prosenttipiste: {
    bad: ["5.–95. prosenttipiste", "prosenttipisteet"],
    ok: ["2 prosenttiyksikköä", "Prosentti"],
  },
  Todennäköisin: {
    bad: ["Todennäköisin", "Todennäköinen väli", "Todennäköisesti se on 3 000–4 000 €"],
    ok: ["Arvio", "Se voi olla 3 000–4 000 €", "Todennäköisyys"],
  },
  "Luvun osat": {
    bad: ["Luvun osat", "luvun osat"],
    ok: ["Mistä luku koostuu", "Luvun selitys"],
  },
  "Valmis kuukausi": {
    bad: ["Valmiiden kuukausien keskiarvo", "kuuden valmiin kuukauden keskiarvo"],
    ok: ["Päättyneiden kuukausien keskiarvo", "Valmis, kuukausi alkaa"],
  },
  Nettovarat: {
    bad: ["Nettovarat", "Nettovarat −119 000 €"],
    ok: ["Varat velkojen jälkeen"],
  },
  Luokka: {
    bad: ["Luokka", "Kaikki luokat", "3 muuta luokkaa 71 €", "Menot luokittain", "Rivit luokasta Verot", "Koti-luokan rivit", "Suurin menoluokka", "Siirrä luokkaan"],
    ok: ["Kategoria", "Luokittele rivi", "Käsin luokitellut", "Luokittelematta 450 €", "Sovellus luokitteli rivit", "Luokitus", "Tule luokse"],
  },
  Jäämä: {
    bad: ["Jäämä", "jäämä kuussa"],
    ok: ["Ylijäämä", "Käteen jäi 120 €"],
  },
  "Tileillä as a figure name": {
    bad: ["Tileillä", "Tileillä yhteensä", "Tileillä ${money(total)}"],
    ok: ["Tilien saldo", "Tilien saldo riittää 3 kuukauden menoihin.", "Tileillä olevat rahat riittävät kolmeksi kuukaudeksi, kun menot pysyvät samana.", "Rahaa tileillä"],
  },
  Linkitä: {
    bad: ["Linkitä tili Enable Bankingissa.", "Tili on linkitetty", "Ylläpitäjä linkittää tilin", "Ei linkitetty"],
    ok: ["Lisää tili Enable Bankingissa (Link accounts).", 'Paina painiketta "Linkitä tili".', "Kopioi linkki ja avaa kaikki linkit.", "Yhdistä pankki"],
  },
  "Yksittäinen osto": {
    bad: ["Suurin yksittäinen osto {name}, {sum}", "yksittäiset ostot"],
    ok: ["Suurin kertaosto {name}, {sum}", "yksittäinen rivi", "Kertaostot"],
  },
  Kello: {
    bad: ["ennen kello {time}", "Kokeiluaika päättyi kello 18.15.", "Kello 6.15"],
    ok: ["ennen klo {time}", "klo 6.15", "Kello on paljon", "kellonaika"],
  },
  "Näin heading": {
    bad: ["Näin katetaan", "Näin lasketaan luku"],
    ok: ["Näin hyvin säästit", "Näitä ei katettu"],
  },
  Katetaan: {
    bad: ["Laskut katetaan.", "Katetaan"],
    ok: ["Laskuihin riittää.", "Laskusi on katettu."],
  },
  "Passive verb": {
    bad: ["Luetaan kuvaa, kun se on valittu", "Tapahtumat haetaan pankin palvelusta.", "Summa lasketaan kerran.", "Se tehdään vasta myöhemmin"],
    ok: ["Luemme kuvaa…", "Testaa yhteys", "Ladataan…", "Testataan yhteyttä", "Kenttä ei kuulu tähän valintaan.", "Lisää kohtaan Päätetyt.", "Haetaan tapahtumia pankista…", "Tallennetaan…", "Laskettu summa", "Päivässä voi kuluttaa enintään 40 €.", "Katso viimeistään perjantaina.", "Maksoit osan omista rahoistasi.", "Kuuluu rahoistaan maksavalle."],
  },
  "Question heading": {
    bad: ["Mihin raha menee?", "Miten tämä kuukausi menee?", "Kestääkö puskuri?", "Paljonko jää säästöön?"],
    ok: ["Rahankäyttö", "Kuukauden tilanne", "Haluatko varmasti poistaa tilin?", "Mihin raha menee. Katso erittely."],
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
