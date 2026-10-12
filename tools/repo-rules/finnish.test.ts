import { describe, expect, it } from "vitest";
import { PATTERNS, breaks } from "./finnish.ts";

const DASH = String.fromCharCode(0x2014);

// One string that breaks the pattern, and one near miss that must pass.
const CASES: Record<string, { bad: string; ok: string }> = {
  "pois lukien": { bad: "Ostot, kertaostot pois lukien.", ok: "Ostot ilman kertaostoja." },
  "täysi kuukausi": { bad: "Vertailuun tarvitaan 12 täyttä kuukautta.", ok: "Vertailuun tarvitaan 12 valmista kuukautta ja täysi vuosi." },
  "calque: laskelma olettaa": { bad: "Laskelma olettaa, että kaikki pysäköinti on asukaspysäköintiä.", ok: "Laskelmassa oletetaan, että kaikki pysäköinti on asukaspysäköintiä." },
  "ending glued to a name": { bad: "${name}-niminen kauppa", ok: "Kauppa ${name}, ostoksia ${count}-${total} kertaa" },
  löydös: { bad: "Löydöstä ei löydy.", ok: "Vinkkiä ei löydy, mutta löydät tiedot Asetuksista." },
  "te-form in the past tense": { bad: "Jos muutitte, lisää muuttopäivä.", ok: "Jos muutit, lisää muuttopäivä. Tutustu esitteeseen ja esitteisiin." },
  syötetty: { bad: "Vuosikulutus, syötetty 1.9.2026", ok: "Vuosikulutus, annettu 1.9.2026" },
  "keskiostos, skripti": { bad: "Keskiostos 24,50 €", ok: "Ostoskerta keskimäärin 24,50 €" },
  "em dash": { bad: `Maksu ${DASH} kuukausi`, ok: "Muutos −312 € kuussa, 1.3.–20.3.2026" },
  '"ei ... vaan" as a contrast': { bad: "Palautus ei ole tuloa, vaan pienentää menoja.", ok: "Ei vain kerran vuodessa, myös kuussa. Vaan-sana on kirjassa." },
  "exclamation mark at the end of a sentence": { bad: "Tiedot tallennettu!", ok: 'Pankin viesti "KIITOS!" näkyy tapahtuman tiedoissa.' },
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
