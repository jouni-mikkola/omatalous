import { describe, expect, it } from "vitest";
import { accountHolder, accountName, bankAccountFields, creditLimitCents, mapTransaction, pickBalance } from "../src/connectors/enable-banking/mapper.ts";

const bal = (balance_type: string, amount: string) => ({ balance_amount: { currency: "EUR", amount }, balance_type });
const row = { transaction_amount: { currency: "EUR", amount: "5.00" }, credit_debit_indicator: "DBIT" as const, status: "BOOK" as const, booking_date: "2026-09-30" };

describe("pickBalance reads the type as balanceReading does", () => {
  it("takes CLBD however it is cased or padded", () => {
    expect(pickBalance([bal("clbd", "1.00"), bal("OPBD", "2.00")])?.balance_amount.amount).toBe("1.00");
    expect(pickBalance([bal(" CLBD", "1.00"), bal("OPBD", "2.00")])?.balance_amount.amount).toBe("1.00");
  });
  it("skips a balance whose amount is no number", () => {
    expect(pickBalance([bal("CLBD", "x"), bal("OPBD", "2.00"), bal("ITBD", "3.00")])?.balance_type).toBe("ITBD");
  });
  it("gives null for none", () => {
    expect(pickBalance([])).toBeNull();
  });
});

describe("creditLimitCents", () => {
  it("reads a limit in lower-case eur", () => {
    expect(creditLimitCents({ uid: "1", credit_limit: { currency: "eur", amount: "500.00" } })).toBe(50000);
  });
});

describe("mapTransaction external id", () => {
  it("falls back to transaction_id when entry_reference is blank", () => {
    expect(mapTransaction({ ...row, entry_reference: "  ", transaction_id: "T1" })!.externalId).toBe("T1");
  });
  it("is null when both are blank", () => {
    expect(mapTransaction({ ...row, entry_reference: "  ", transaction_id: " " })!.externalId).toBeNull();
  });
});

describe("account text with a control or zero-width character", () => {
  it("maps the product, the holder and the name with a space", () => {
    const a = { uid: "1", name: "Anna\u0000\u200BKorhonen;Bo\u2028Li", product: "Pikatili\u0007\u200B  plus" };
    expect(bankAccountFields(a).bankProduct).toBe("Pikatili plus");
    expect(accountHolder(a)).toBe("Anna Korhonen, Bo Li");
    expect(accountName(a)).toBe("Pikatili plus");
    expect(accountName({ uid: "1", name: "A\u0001B" })).toBe("A B");
  });
  it("keeps clean text as it was", () => {
    expect(bankAccountFields({ uid: "1", product: "  A  B ", usage: "priv", psu_status: "x\ty" }).bankProduct).toBe("A  B");
    expect(accountHolder({ uid: "1", name: "A  B" })).toBe("A  B");
  });
});
