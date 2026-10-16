import { describe, expect, it } from "vitest";
import { partyKind } from "../src/party-kind.ts";

describe("partyKind", () => {
  it.each([
    "Matti Meikäläinen",
    "Meikäläinen Matti",
    "Liisa Virtanen",
    "Virtanen Liisa",
    "Anna-Liisa Korhonen",
    "Korhonen Anna-Liisa",
    "Pekka Juhani Nieminen",
    "Nieminen Pekka Juhani",
    "Åsa Lindberg",
    "Lindberg Åsa",
    "Virtanen Åsa",
    "Olli Heikkinen",
    "Heikkinen Olli",
    "Oskar Ås",
    "Lindqvist Asa",
    "Mehmet Ay",
    "Nguyen Van Ky",
    "Virtanen Ky",
    "Kyllikki Ahonen",
    "Ahonen Kyllikki",
  ])("%s is a person", (name) => {
    expect(partyKind(name)).toBe("person");
  });

  it.each([
    "Virtanen Oy",
    "Oy Virtanen Ab",
    "Matti Meikäläinen Tmi",
    "Tmi Matti Meikäläinen",
    "Esimerkki Oyj",
    "Nordic Example AB",
    "Example AB Filial",
    "Esimerkki Autohuolto Ky",
    "Esimerkki Kauppa AS",
    "Example Palvelut ASA",
    "Esimerkki Rakennus Ay",
    "Example Ltd",
    "Example GmbH",
    "AS OY Esimerkki",
    "Arval Service Lease Finland",
    "Kiertokapula Oy",
    "Lahti Energia",
  ])("%s is a company", (name) => {
    expect(partyKind(name)).toBe("company");
  });

  it("reads a business id in the text the bank gives", () => {
    expect(partyKind("Esimerkki Matti")).toBe("person");
    expect(partyKind("Esimerkki Matti", "Y-tunnus 1234567-8")).toBe("company");
    expect(partyKind("Esimerkki Matti", "viite 12345678")).toBe("person");
    expect(partyKind("Example ASA", "Y-tunnus 1234567-8")).toBe("company");
    expect(partyKind("Example ASA")).toBe("person");
  });

  it("does not tell a name of one word, of four, or with a trade word", () => {
    expect(partyKind("Matti")).toBe("unknown");
    expect(partyKind("Matti Juhani Olavi Meikäläinen")).toBe("unknown");
    expect(partyKind("Esimerkki Autohuolto")).toBe("unknown");
    expect(partyKind("")).toBe("unknown");
  });
});

describe("partyKind of banks and insurers", () => {
  it.each(["Nordea Bank Abp", "Nordea", "OP", "Danske Bank", "If Vahinkovakuutus", "S-Pankki", "Säästöpankki", "Oma Säästöpankki", "POP Pankki", "Handelsbanken", "Ålandsbanken", "LähiTapiola", "Fennia", "Pohjola Vakuutus", "Turva", "Aktia", "Esimerkki Försäkring", "Example Insurance", "Esimerkki Sparbank"])(
    "%s is a company",
    (name) => {
      expect(partyKind(name)).toBe("company");
    },
  );

  it("a person whose name only starts like a bank is still a person", () => {
    expect(partyKind("Matti Pankkinen")).toBe("person");
  });
});
