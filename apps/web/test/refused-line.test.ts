/** Tietojen laatu: the rows of an account's last fetch the app could not read, in one sentence. Made-up account. */
import { describe, expect, it } from "vitest";
import { refusedLine } from "../src/pages/reports/quality.tsx";

describe("the line of rows left unread", () => {
  it("says nothing when every row was read", () => {
    expect(refusedLine("Käyttötili", null)).toBeNull();
    expect(refusedLine("Käyttötili", {})).toBeNull();
  });

  it("counts the rows and names each reason that had one", () => {
    expect(refusedLine("Käyttötili", { status: 1 })).toBe("Käyttötili: viime haussa 1 rivi jäi lukematta: 1 rivi, jonka tila on tuntematon. Ne puuttuvat luvuista.");
    expect(refusedLine("Nordea Gold", { status: 2, amount: 1, date: 1 })).toBe(
      "Nordea Gold: viime haussa 4 riviä jäi lukematta: 2 riviä, joiden tila on tuntematon, 1 ilman luettavaa summaa ja 1 ilman päivämäärää. Ne puuttuvat luvuista.",
    );
  });

  it("tells the twins apart from the unreadable rows", () => {
    expect(refusedLine("Käyttötili", { twin: 2 })).toBe("Käyttötili: viime haussa ohitimme 2 riviä, koska sama maksu oli jo tallessa toisesta lähteestä. Ne ovat luvuissa kerran.");
    expect(refusedLine("Käyttötili", { amount: 1, twin: 1 })).toBe(
      "Käyttötili: viime haussa 1 rivi jäi lukematta: 1 ilman luettavaa summaa. Ne puuttuvat luvuista. Lisäksi ohitimme 1 rivin, koska sama maksu oli jo tallessa toisesta lähteestä. Se on luvuissa kerran.",
    );
  });
});
