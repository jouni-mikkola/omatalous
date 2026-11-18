/** The name an account shows: the user's own, else the bank's without the card type the bank adds in brackets. */
import { describe, expect, it } from "vitest";
import { toAccount } from "../src/db/rows.ts";
import type { Row } from "../src/db/rows.ts";

const row = (name: string, customName: string | null): Row => ({ id: "a1", user_id: "u1", provider: "enable-banking", name, custom_name: customName, currency: "EUR", type: "credit_card" });

describe("the display name of an account", () => {
  it("drops the card type in brackets from the bank's name and keeps the bank's own name for matching", () => {
    const account = toAccount(row("Nordea Gold (credit)", null));
    expect(account.name).toBe("Nordea Gold");
    expect(account.bankName).toBe("Nordea Gold (credit)");
  });

  it("near miss: the user's own name is shown as it was written", () => {
    expect(toAccount(row("Nordea Gold (credit)", "Kortti (credit)")).name).toBe("Kortti (credit)");
  });

  it("near miss: a name that is not a card type stays", () => {
    expect(toAccount(row("Perhetili (Eero)", null)).name).toBe("Perhetili (Eero)");
  });
});
