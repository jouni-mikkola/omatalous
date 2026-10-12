import { describe, expect, it } from "vitest";
import { debtTotalName, maskedNames, splitAccounts } from "../src/components/holdings/holding-rows.ts";

const account = (id: string, balanceCents: number | null, name = id, mask: string | null = null) => ({ id, name, balanceCents, mask });

describe("splitAccounts", () => {
  it("folds nothing for four accounts or fewer, whatever they hold", () => {
    const four = [account("a", 0), account("b", 50), account("c", -99), account("d", null)];
    expect(splitAccounts(four)).toEqual({ shown: four, folded: [] });
  });

  it("folds the accounts under a euro on either side of zero once there are five, in their order", () => {
    const five = [account("a", 120_050), account("b", 99), account("c", -99), account("d", 0), account("e", 5_000)];
    const { shown, folded } = splitAccounts(five);
    expect(shown.map((a) => a.id)).toEqual(["a", "e"]);
    expect(folded.map((a) => a.id)).toEqual(["b", "c", "d"]);
  });

  it("keeps the account at exactly 1,00 either side, and the one without a balance, in the list", () => {
    const five = [account("a", 100), account("b", -100), account("c", null), account("d", 99), account("e", 0)];
    const { shown, folded } = splitAccounts(five);
    expect(shown.map((a) => a.id)).toEqual(["a", "b", "c"]);
    expect(folded.map((a) => a.id)).toEqual(["d", "e"]);
  });

  it("folds nothing when no account of five is under a euro", () => {
    const five = ["a", "b", "c", "d", "e"].map((id) => account(id, 10_000));
    expect(splitAccounts(five)).toEqual({ shown: five, folded: [] });
  });
});

describe("maskedNames", () => {
  it("gives a mask to each of the accounts that share a name, and to no other", () => {
    const masks = maskedNames([account("a", 1, "Käyttötili", "1234"), account("b", 1, "Käyttötili", "5678"), account("c", 1, "Säästötili", "9999")]);
    expect([...masks]).toEqual([["a", "1234"], ["b", "5678"]]);
  });

  it("compares names without case and extra spaces", () => {
    const masks = maskedNames([account("a", 1, "Käyttötili", "1234"), account("b", 1, " käyttötili  ", "5678")]);
    expect([...masks.keys()]).toEqual(["a", "b"]);
  });

  it("leaves out an account that has no number, and a name that stands alone", () => {
    expect([...maskedNames([account("a", 1, "Käyttötili", "1234"), account("b", 1, "Käyttötili", null)])]).toEqual([["a", "1234"]]);
    expect(maskedNames([account("a", 1, "Käyttötili", "1234")]).size).toBe(0);
    expect(maskedNames([]).size).toBe(0);
  });
});

describe("debtTotalName", () => {
  const card = (usedCents: number | null) => ({ usedCents });

  it("is the debts when a card has something used, the loans when none has", () => {
    expect(debtTotalName([card(0), card(12_000)])).toBe("Velat yhteensä");
    expect(debtTotalName([card(0), card(null)])).toBe("Lainat yhteensä");
    expect(debtTotalName([])).toBe("Lainat yhteensä");
  });
});
