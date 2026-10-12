import { describe, expect, it } from "vitest";
import { accountType, bankTxnCode, mapTransaction, pickBalance } from "../src/connectors/enable-banking/mapper.ts";

describe("the bank's own transaction code", () => {
  it.each([
    [{ code: "CCRD", sub_code: "POSD" }, "CCRD-POSD"],
    [{ code: "PMNT", sub_code: "CCRD-POSD" }, "PMNT-CCRD-POSD"],
    [{ code: "PMNT-RCDT-SALA" }, "PMNT-RCDT-SALA"],
    [{ code: " pmnt/rcdt ", sub_code: "sala" }, "PMNT-RCDT-SALA"],
    [{ description: "Korttiosto", code: "CCRD", sub_code: "POSD" }, "CCRD-POSD"],
    // a family without its sub-family, free text, a bank's own numbering, too many parts, nothing
    [{ code: "CCRD", sub_code: null }, null],
    [{ code: "Pano" }, null],
    [{ code: "Korttiosto" }, null],
    [{ code: "Käteisnosto", sub_code: "Otto" }, null],
    [{ code: "710" }, null],
    [{ code: "PMNT-CCRD-POSD-XTRA" }, null],
    [{ code: "PMNT", sub_code: "CCRD-POSD-XTRA" }, null],
    [{ code: 721 as unknown as string }, null],
    [{ description: "Korttiosto" }, null],
    [{}, null],
    [null, null],
    [undefined, null],
  ])("%j → %s", (code, expected) => expect(bankTxnCode(code)).toBe(expected));

  it("is kept on the row beside the description, and a row without one has null", () => {
    const row = { transaction_amount: { currency: "EUR", amount: "60.00" }, credit_debit_indicator: "DBIT" as const, status: "BOOK" as const, booking_date: "2026-09-30" };
    const coded = mapTransaction({ ...row, bank_transaction_code: { description: "Nosto", code: "PMNT", sub_code: "CCRD-CWDL" } });
    expect(coded).toMatchObject({ description: "Nosto", bankTxnCode: "PMNT-CCRD-CWDL", amountCents: -6000 });
    expect(mapTransaction({ ...row, remittance_information: ["Korttiosto"], bank_transaction_code: { description: "Korttiosto" } })!.bankTxnCode).toBeNull();
    expect(mapTransaction(row)!.bankTxnCode).toBeNull();
  });
});

describe("Enable Banking mapping", () => {
  it("maps a card purchase", () => {
    const t = mapTransaction({
      entry_reference: "ref-1",
      transaction_amount: { currency: "EUR", amount: "23.45" },
      credit_debit_indicator: "DBIT",
      status: "BOOK",
      booking_date: "2026-09-30",
      creditor: { name: "K-MARKET KAMPPI" },
      remittance_information: ["Korttiosto", "K-MARKET KAMPPI HELSINKI"],
      merchant_category_code: "5411",
    });
    expect(t).toMatchObject({
      externalId: "ref-1",
      amountCents: -2345,
      status: "booked",
      counterparty: "K-MARKET KAMPPI",
      description: "Korttiosto K-MARKET KAMPPI HELSINKI",
      mcc: "5411",
    });
  });

  it("maps incoming money and skips rejected transactions", () => {
    expect(
      mapTransaction({
        transaction_amount: { currency: "EUR", amount: "3420.00" },
        credit_debit_indicator: "CRDT",
        status: "PDNG",
        value_date: "2026-09-25",
        debtor: { name: "ACME OY" },
        debtor_account: { iban: "FI5512345600000123" },
      }),
    ).toMatchObject({ amountCents: 342000, status: "pending", counterparty: "ACME OY", counterpartyIban: "FI5512345600000123", bookingDate: "2026-09-25" });
    expect(mapTransaction({ transaction_amount: { currency: "EUR", amount: "1" }, credit_debit_indicator: "DBIT", status: "RJCT", booking_date: "2026-01-01" })).toBeNull();
  });

  it("recognises account types and picks the booked balance", () => {
    expect(accountType({ uid: "1", cash_account_type: "CARD" })).toBe("credit_card");
    expect(accountType({ uid: "1", name: "Nordea Mastercard luottokortti" })).toBe("credit_card");
    expect(accountType({ uid: "1", cash_account_type: "CACC", name: "Käyttötili" })).toBe("checking");
    expect(
      pickBalance([
        { balance_amount: { currency: "EUR", amount: "10" }, balance_type: "ITAV" },
        { balance_amount: { currency: "EUR", amount: "12" }, balance_type: "CLBD" },
      ])?.balance_amount.amount,
    ).toBe("12");
  });
});

describe("account types from Nordea's list", () => {
  it.each([
    [{ uid: "1", name: "Käyttötili", cash_account_type: "CACC", account_id: { iban: "FI35..." } }, "checking"],
    [{ uid: "2", name: "Pitkäsäästö", cash_account_type: "SVGS" }, "savings"],
    [{ uid: "3", name: "Lyhytsäästö" }, "savings"],
    [{ uid: "4", name: "Asuntolainatili", cash_account_type: "LOAN" }, "loan"],
    [{ uid: "5", name: "Nordea Gold (credit)", account_id: { other: { identification: "5225********1144", scheme_name: "CPAN" } } }, "credit_card"],
    [{ uid: "6", name: "Tili", account_id: { other: { identification: "5225********1144", scheme_name: "CPAN" } } }, "credit_card"],
  ])("%j → %s", (account, type) => expect(accountType(account as never)).toBe(type));
});
