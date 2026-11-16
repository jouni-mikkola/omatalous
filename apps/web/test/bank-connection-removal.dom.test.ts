/**
 * Removing a bank connection: a connection is a consent at the bank, so it has one Poista on the bank's row, which asks first
 * and names the accounts it stops reading. The form of an account has no such button.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import "./fixed-clock.ts";
import { Accounts } from "../src/pages/settings/Accounts.tsx";
import { BankConnections } from "../src/pages/settings/BankConnections.tsx";
import type { Account, Connection, Meta } from "../src/types.ts";
import { stubApi } from "./dom-kit.ts";

const BANKS = [
  { id: "nordea-fi", name: "Nordea", country: "FI" },
  { id: "op-fi", name: "OP", country: "FI" },
];
const T = { timeout: 15000 };

const consent = (id: string, institution = "Nordea"): Connection => ({
  id,
  institution,
  status: "active",
  state: "active",
  history: false,
  replaced: false,
  validUntil: "2027-01-14T00:00:00Z",
  createdAt: "2026-06-01T00:00:00Z",
  lastSyncedAt: null,
  daysLeft: 93,
  needsRenewal: false,
});
const account = (name: string, connectionId: string | null, iban: string | null = null): Account =>
  ({ id: name, userId: "u1", name, bankName: name, customName: null, holder: null, connectionId, iban, cardMask: null, creditLimitCents: null, currency: "EUR", type: "checking", provider: "enablebanking", balanceCents: null, balanceAt: null, lastSyncedAt: "2026-10-11T06:00:00Z", problem: null }) as unknown as Account;

const meta = (connections: Connection[], accounts: Account[]) =>
  ({ today: "2026-10-12", user: { id: "u1", role: "member" }, members: [{ id: "u1", displayName: "Matti" }], shares: [], bank: { configured: true, banks: BANKS, redirectMode: "own", source: "user" }, connections, accounts, renewal: { due: [], round: null } }) as unknown as Meta;

const openBanks = (connections: Connection[], accounts: Account[]) => {
  const seen = stubApi(Object.fromEntries(connections.map((c) => [`DELETE /api/connections/${c.id}`, {}])));
  render(createElement(BankConnections, { meta: meta(connections, accounts), pickerOpen: false, onChange: () => {}, onMessage: () => {} }));
  return seen;
};
const deletes = (seen: { method: string; path: string }[]) => seen.filter((s) => s.method === "DELETE").map((s) => s.path);

describe("Poista on the row of a bank", () => {
  it("asks first, names the accounts it stops reading, and ends only the consents of that bank", async () => {
    const seen = openBanks(
      [consent("a"), consent("b"), consent("o", "OP")],
      [account("Käyttötili", "a", "FI2112345600000785"), account("Säästötili", "a", "FI4950009420028730"), account("Nordea Gold", "b"), account("OP-tili", "o")],
    );
    // one Poista for each bank, not one for each account
    expect(screen.getAllByRole("button", { name: /^Poista pankkiyhteys: / })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Poista pankkiyhteys: Nordea" }));
    const dialog = await screen.findByRole("dialog", { hidden: true });
    expect(dialog.textContent).toContain("Poista pankkiyhteys Nordea?");
    expect(dialog.textContent).toContain("Käyttötili · FI21 1234 5600 0007 85");
    expect(dialog.textContent).toContain("Säästötili · FI49 5000 9420 0287 30");
    expect(dialog.textContent).toContain("Nordea Gold");
    expect(dialog.textContent).not.toContain("OP-tili");
    expect(deletes(seen)).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Poista pankkiyhteys", hidden: true }));
    await waitFor(() => expect(deletes(seen)).toEqual(["/api/connections/a", "/api/connections/b"]), T);
    await waitFor(() => expect(document.querySelector("dialog")).toBeNull(), T);
  }, 60000);

  it("removes a consent that reads no accounts, and says so", async () => {
    const seen = openBanks([consent("a")], []);
    fireEvent.click(screen.getByRole("button", { name: "Poista pankkiyhteys: Nordea" }));
    const dialog = await screen.findByRole("dialog", { hidden: true });
    expect(dialog.textContent).toContain("Yhteys ei lue yhtään tiliä.");
    expect(dialog.textContent).not.toContain("näiden tilien lukemisen");
    fireEvent.click(within(dialog).getByRole("button", { name: "Poista pankkiyhteys", hidden: true }));
    await waitFor(() => expect(deletes(seen)).toEqual(["/api/connections/a"]), T);
  }, 60000);

  it("sends nothing when the question is cancelled", async () => {
    const seen = openBanks([consent("a")], [account("Käyttötili", "a")]);
    fireEvent.click(screen.getByRole("button", { name: "Poista pankkiyhteys: Nordea" }));
    const dialog = await screen.findByRole("dialog", { hidden: true });
    fireEvent.click(within(dialog).getByRole("button", { name: "Peruuta", hidden: true }));
    await waitFor(() => expect(document.querySelector("dialog")).toBeNull(), T);
    expect(deletes(seen)).toEqual([]);
  }, 60000);
});

describe("The form of an account", () => {
  it("has no button that removes the bank connection", async () => {
    const seen = stubApi({ "GET /api/foreign-rows": {} });
    render(createElement(Accounts, { meta: meta([consent("a")], [account("Käyttötili", "a", "FI2112345600000785"), account("Säästötili", "a", "FI4950009420028730")]), onChange: () => {} }));
    fireEvent.click(await screen.findByRole("button", { name: /^Muokkaa tiliä Käyttötili/ }, T));
    await screen.findByRole("textbox", { name: /^Tilin nimi/ }, T);
    expect(screen.queryAllByRole("button", { name: /pankkiyhteys/i, hidden: true })).toHaveLength(0);
    expect(deletes(seen)).toEqual([]);
  }, 60000);
});
