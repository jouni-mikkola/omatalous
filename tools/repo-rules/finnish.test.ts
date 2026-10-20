import { describe, expect, it } from "vitest";
import { PATTERNS, breaks } from "./finnish.ts";

const DASH = String.fromCharCode(0x2014);

// One string that breaks the pattern, and one near miss that must pass.
const CASES: Record<string, { bad: string; ok: string }> = {
  "pois lukien": { bad: "Ostot, kertaostot pois lukien.", ok: "Ostot ilman kertaostoja." },
  "täysi kuukausi": { bad: "Laskettu edellisistä täysistä kuukausista ja 12 täyttä kuukautta.", ok: "Vertailuun tarvitaan 12 valmista kuukautta ja täysi vuosi. Täytä kuukauden tiedot." },
  "calque: laskelma olettaa": { bad: "Laskelma olettaa, että kaikki pysäköinti on asukaspysäköintiä.", ok: "Laskelmassa oletetaan, että kaikki pysäköinti on asukaspysäköintiä." },
  "ending glued to a name": { bad: "${name}-niminen kauppa", ok: "Kauppa ${name}, ostoksia ${count}-${total} kertaa" },
  löydös: { bad: "Löydöstä ei löydy.", ok: "Vinkkiä ei löydy, mutta löydät tiedot Asetuksista." },
  "te-form in the past tense": { bad: "Jos muutitte, lisää muuttopäivä.", ok: "Jos muutit, lisää muuttopäivä. Tutustu esitteeseen ja esitteisiin." },
  syötetty: { bad: "Vuosikulutus, syötetty 1.9.2026", ok: "Vuosikulutus, annettu 1.9.2026" },
  "keskiostos, skripti": { bad: "Keskiostos 24,50 €", ok: "Ostoskerta keskimäärin 24,50 €" },
  "em dash": { bad: `Maksu ${DASH} kuukausi`, ok: "Muutos −312 € kuussa, 1.3.–20.3.2026" },
  '"ei ... vaan" as a contrast': { bad: "Palautus ei ole tuloa, vaan pienentää menoja.", ok: "Ei vain kerran vuodessa, myös kuussa. Vaan-sana on kirjassa." },
  "exclamation mark at the end of a sentence": { bad: "Tiedot tallennettu!", ok: 'Pankin viesti "KIITOS!" näkyy tapahtuman tiedoissa.' },
  "Ylläpitäjä tarkistaa as an instruction": { bad: "Ylläpitäjä tarkistaa sen kohdassa Asetukset > Palvelin.", ok: "Ylläpitäjän pitää tarkistaa se. Ylläpitäjä voi tarkistaa sen. Ylläpitäjä nollasi salasanasi." },
  "a thing that needs": { bad: "Vertailu tarvitsee ${completeMonths(3)}.", ok: "Vertailuun tarvitaan ${completeMonths(3)}. Tarvitset 3 valmista kuukautta." },
  "alkaen before a date": { bad: "Hinta 12 € alkaen ${monthYear(start)}, alkaen 10/2026", ok: "Hinta 12 € ${monthYear(start)} alkaen, alkaen tammikuusta, ${elative(month)} alkaen ${eur(level)} kuussa" },
  "money that pays": { bad: "Luottokortin korot maksoivat 120 € vuodessa", ok: "Luottokortin korkoihin meni 120 €, ja kulut maksoit itse." },
  "kuin mitä": { bad: "Lainaa on jäljellä enemmän kuin mitä myönnettiin.", ok: "Lainaa on jäljellä enemmän kuin sitä myönnettiin, enemmän kuin mitään muuta." },
  "ei ole saatavilla": { bad: "Kortin ostoksia ei ole saatavilla.", ok: "Päivitys on saatavilla. Kortin ostoja ei näy." },
  "ei X annettu": { bad: "ei syytä annettu", ok: "syytä ei annettu, lukua ei vielä annettu" },
  odotetusti: { bad: "Kauppa ei vastannut odotetusti.", ok: "Odotettu lasku tuli ajallaan." },
  "suuntaa-antava": { bad: "Luvut ovat suuntaa-antavia.", ok: "Luvut ovat suuntaa antavia." },
  "Yritä uudelleen myöhemmin": { bad: "Yritä uudelleen myöhemmin.", ok: "Yritä myöhemmin uudelleen. Hae uudelleen, myöhemmin tänään." },
  ostokerta: { bad: "Ostokerrat", ok: "Ostoskerrat, ostoskerta keskimäärin" },
  löydetty: { bad: "Löydetty vuodessa", ok: "Ei löytynyt. Löydät sen Asetuksista." },
  "kuukaudessa as a rate": { bad: "Kiinteät menot 820 € kuukaudessa", ok: "Säästit kolmessa kuukaudessa 300 €, 12 € kuussa." },
  "X ei tiedossa as a label": { bad: "Kauppa ei tiedossa", ok: "Tuntematon kauppa, laina ei tiedossa" },
};

describe("rule 28: the patterns of the Finnish voice", () => {
  it("has a case for every pattern, and no case for a pattern that is gone", () => {
    expect(Object.keys(CASES).sort()).toEqual(PATTERNS.map((p) => p.name).sort());
  });

  for (const p of PATTERNS) {
    it(`${p.name}: finds its string and passes its near miss`, () => {
      const { bad, ok } = CASES[p.name]!;
      expect(breaks(bad).map((b) => b.name)).toContain(p.name);
      expect(breaks(ok).map((b) => b.name)).not.toContain(p.name);
    });
  }

  it("takes the plain sentence the app writes today", () => {
    expect(breaks("Palautus aiemmasta maksusta. Pienentää menoja, ei ole tuloa.")).toEqual([]);
    expect(breaks("Harvinaiset laskut ovat 564 € vuodessa eli 47 € kuussa.")).toEqual([]);
  });
});
