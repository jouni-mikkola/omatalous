/**
 * The balance box of an imported account shows an example sum in the form of the language, and reads back what it shows.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { eurosText, parseEuros, setLanguage } from "../src/format.ts";
import { Accounts } from "../src/pages/settings/Accounts.tsx";
import type { Account, Meta } from "../src/types.ts";
import { stubApi } from "./dom-kit.ts";

const csv = { id: "a1", userId: "u1", name: "Tili", bankName: "Tili", customName: null, holder: null, cardMask: null, creditLimitCents: null, iban: null, currency: "EUR", type: "checking", provider: "csv", connectionId: null, balanceCents: null, balanceAt: null, lastSyncedAt: null, problem: null } as unknown as Account;
const meta = { user: { id: "u1", role: "member" }, members: [{ id: "u1", displayName: "Matti" }], shares: [], bank: { configured: true, banks: [], redirectMode: "own", source: "user" }, connections: [], accounts: [csv], renewal: { due: [], round: null } } as unknown as Meta;

/** The two boxes of the form of the account: the name and the balance. */
function openForm() {
  stubApi({ "GET /api/foreign-rows": {} });
  const view = render(createElement(Accounts, { meta, onChange: () => {} }));
  fireEvent.click(view.container.querySelector("button[aria-label]")!);
  return {
    name: view.container.querySelector<HTMLInputElement>('input[maxlength="80"]')!,
    balance: view.container.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!,
  };
}

afterEach(() => {
  cleanup();
  setLanguage("fi");
});

describe("Saldon esimerkki", () => {
  it("is the example sum in Finnish, and the name box keeps the bank's name", () => {
    setLanguage("fi");
    const { name, balance } = openForm();
    expect(balance.placeholder).toBe("1 234,56");
    expect(name.placeholder).toBe("Tili");
  });

  it("is the example sum in English, and the app reads that form back", () => {
    setLanguage("en");
    const { balance } = openForm();
    expect(balance.placeholder).toBe("1,234.56");
    expect(parseEuros(balance.placeholder)).toBe(123456);
  });

  it("round-trips an amount in both languages", () => {
    for (const lang of ["fi", "en"] as const) {
      setLanguage(lang);
      for (const cents of [0, 5, 123456, -123456, 12_345_678]) expect(parseEuros(eurosText(cents))).toBe(cents);
    }
  });
});
