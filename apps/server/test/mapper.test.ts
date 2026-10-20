import { describe, expect, it } from "vitest";
import { accountType, bankAccountFields, bankTxnCode, mapTransaction, pickBalance } from "../src/connectors/enable-banking/mapper.ts";

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
    expect(accountType({ uid: "1", product: "Nordea Mastercard luottokortti" })).toBe("credit_card");
    expect(accountType({ uid: "1", cash_account_type: "CACC", product: "Käyttötili" })).toBe("checking");
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
    [{ uid: "1", product: "Käyttötili", cash_account_type: "CACC", account_id: { iban: "FI35..." } }, "checking"],
    [{ uid: "2", product: "Pitkäsäästö", cash_account_type: "SVGS" }, "savings"],
    [{ uid: "3", product: "Lyhytsäästö" }, "savings"],
    [{ uid: "4", product: "Asuntolainatili", cash_account_type: "LOAN" }, "loan"],
    [{ uid: "5", product: "Nordea Gold (credit)", account_id: { other: { identification: "5225********1144", scheme_name: "CPAN" } } }, "credit_card"],
    [{ uid: "6", product: "Tili", account_id: { other: { identification: "5225********1144", scheme_name: "CPAN" } } }, "credit_card"],
  ])("%j → %s", (account, type) => expect(accountType(account as never)).toBe(type));
});

describe("account type without the bank's code", () => {
  const joint = { uid: "1", name: "Ricardo Laine;Sloane Virta", product: "Käyttötili", account_id: { iban: "FI2112345600000785" } };

  it("never reads the holders' names: two holders whose names hold 'card' and 'loan' keep a current account", () => {
    expect(accountType(joint)).toBe("checking");
    expect(accountType({ ...joint, cash_account_type: "OTHR" })).toBe("checking");
    // near miss: the bank's own code still makes it a loan
    expect(accountType({ ...joint, cash_account_type: "LOAN" })).toBe("loan");
  });

  it("calls an account with an IBAN and no word for its kind a current account, one with neither other", () => {
    expect(accountType({ uid: "1", name: "Aino Laina", account_id: { iban: "FI2112345600000785" } })).toBe("checking");
    expect(accountType({ uid: "1", name: "Aino Laina" })).toBe("other");
    expect(accountType({ uid: "1", product: "Asuntolaina", account_id: { iban: "FI2112345600000785" } })).toBe("loan");
  });

  it("keeps what the bank says of the account as sent, trimmed, the code in upper case and \"\" when none was sent", () => {
    expect(bankAccountFields({ ...joint, cash_account_type: " cacc ", usage: "priv", psu_status: "Co-account Holder" })).toEqual({
      bankTypeCode: "CACC",
      bankUsage: "PRIV",
      bankProduct: "Käyttötili",
      psuStatus: "Co-account Holder",
    });
    expect(bankAccountFields({ uid: "1", cash_account_type: "not a code!" })).toEqual({ bankTypeCode: "", bankUsage: null, bankProduct: null, psuStatus: null });
  });
});

describe("the other party's account given as another identification", () => {
  const paid = (other: { identification?: string; scheme_name?: string }) =>
    mapTransaction({ transaction_amount: { currency: "EUR", amount: "617.00" }, credit_debit_indicator: "DBIT", status: "BOOK", booking_date: "2026-03-02", creditor_account: { other } })?.counterpartyIban;

  it("reads a Finnish account number as its IBAN, so the payment to an own account is found by it", () => {
    expect(paid({ identification: "123456-785", scheme_name: "BBAN" })).toBe("FI2112345600000785");
    // a bank whose numbers start with 4 or 5 takes the zeros after the seventh digit
    expect(paid({ identification: "423456-781", scheme_name: "BBAN" })).toBe("FI5542345670000081");
    expect(paid({ identification: "12345600000785" })).toBe("FI2112345600000785");
  });

  it("takes an IBAN the bank put there, whatever its scheme", () => {
    expect(paid({ identification: "fi21 1234 5600 0007 85", scheme_name: "IBAN" })).toBe("FI2112345600000785");
  });

  it("leaves a number whose check fails, or of another scheme, unknown", () => {
    expect(paid({ identification: "123456-786", scheme_name: "BBAN" })).toBeNull();
    expect(paid({ identification: "FI2112345600000786" })).toBeNull();
    expect(paid({ identification: "12345600000785", scheme_name: "CPAN" })).toBeNull();
  });
});
