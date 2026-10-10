import { describe, expect, it } from "vitest";
import { parseAmount, parseBankCsv, parseDate } from "../src/providers/csv/nordea.ts";

describe("parseBankCsv", () => {
  it("reads Nordea's current netbank export", () => {
    const csv = [
      "Kirjauspäivä;Määrä;Maksaja;Maksunsaaja;Nimi;Otsikko;Viitenumero;Valuutta",
      "2026/09/30;-23,45;FI2112345600000785;;;K-MARKET KAMPPI;;EUR",
      "2026/09/29;3 420,00;FI5512345600000123;FI2112345600000785;ACME OY;PALKKA;;EUR",
      '2026/09/28;-1050,00;FI2112345600000785;FI7912345600000456;SATO OYJ;"VUOKRA; LOKAKUU";1234561;EUR',
      "Varaus;-5,90;FI2112345600000785;;;WOLT;;EUR",
    ].join("\n");
    const { transactions, errors } = parseBankCsv(`﻿${csv}`);
    expect(errors).toEqual([]);
    expect(transactions).toHaveLength(3);
    expect(transactions[0]).toMatchObject({ bookingDate: "2026-09-30", amountCents: -2345, description: "K-MARKET KAMPPI" });
    expect(transactions[1]).toMatchObject({ amountCents: 342000, counterparty: "ACME OY", counterpartyIban: "FI5512345600000123" });
    expect(transactions[2]).toMatchObject({ description: "VUOKRA; LOKAKUU", counterpartyIban: "FI7912345600000456", reference: "1234561" });
  });

  it("reads the older tab separated export", () => {
    const txt = [
      "Kirjauspäivä\tArvopäivä\tMaksupäivä\tMäärä\tSaaja/Maksaja\tTilinumero\tBIC\tTapahtuma\tViite\tMaksajan viite\tViesti\tKortinnumero\tKuitti",
      "15.01.2025\t15.01.2025\t14.01.2025\t-12,90\tSPOTIFY\t\t\tKorttiosto\t\t\t\t4581 XXXX XXXX 1234\t",
    ].join("\r\n");
    const { transactions } = parseBankCsv(txt);
    expect(transactions[0]).toMatchObject({ bookingDate: "2025-01-15", amountCents: -1290, counterparty: "SPOTIFY" });
  });

  it("explains a file it cannot read", () => {
    expect(parseBankCsv("foo;bar\n1;2").errors[0]).toMatch(/ei tunnistettu/);
  });

  it("parses amounts and dates in common formats", () => {
    expect(parseAmount("1.234,56")).toBe(123456);
    expect(parseAmount("+12,5")).toBe(1250);
    expect(parseAmount("-0,99 €")).toBe(-99);
    expect(parseDate("2026-1-5")).toBe("2026-01-05");
    expect(parseDate("5.1.2026")).toBe("2026-01-05");
  });
});
