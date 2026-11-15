/** Tapahtumat on a phone: the account's mark is left out when every row would show one bank's logo. */
import { describe, expect, it } from "vitest";
import { type AccountLook, oneBankLogo } from "../src/pages/transactions/Marks.tsx";

const look = (name: string, bank: string): AccountLook => ({ name, bank, banks: [], short: "•• 0000" });

describe("oneBankLogo", () => {
  it("holds when every account of the rows is at one bank that has a logo", () => {
    expect(oneBankLogo([look("Käyttötili", "Nordea"), look("Säästötili", "Nordea Bank Abp")])).toBe(true);
  });
  it("does not hold for a bank with no logo: the initials differ by account", () => {
    expect(oneBankLogo([look("Käyttötili", "Tuntematon pankki"), look("Säästötili", "Tuntematon pankki")])).toBe(false);
    expect(oneBankLogo([look("Käyttötili", ""), look("Säästötili", "")])).toBe(false);
  });
  it("does not hold when one row's account has no logo, is unknown, or there is no row", () => {
    expect(oneBankLogo([look("Käyttötili", "Nordea"), look("Säästötili", "Tuntematon pankki")])).toBe(false);
    expect(oneBankLogo([look("Käyttötili", "Nordea"), undefined])).toBe(false);
    expect(oneBankLogo([])).toBe(false);
  });
});
