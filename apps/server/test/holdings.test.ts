/**
 * What the first page reads of accounts and cards (`holdings` of the balance report and of the dashboard): the bank, the
 * mask and the limit stored for an account reach it, and only for the accounts the request's scope holds. A member sees
 * another member's card only when it was shared with them, and then without the owner's bank, as the account lists have
 * it. Names, masks and limits are made up.
 */
import type { AccountType } from "@banking/core";
import { describe, expect, it } from "vitest";
import { type Client, NOW, setupApp } from "./helpers.ts";

/** Aino and Eero share a household; Maija is another household's, and nothing is shared with her. */
async function households() {
  const app = await setupApp();
  const eero = await app.member("eero", "Eero");
  const maija = await app.member("maija", "Maija");
  const bank = (userId: string, id: string, institution: string) =>
    app.s.finance(userId).upsertConnection({ id, provider: "enablebanking", institution, country: "FI", status: "active", validUntil: null, createdAt: NOW.toISOString(), lastSyncedAt: null });
  const account = async (userId: string, id: string, type: AccountType, connectionId: string, balanceCents: number, more: { cardMask?: string; creditLimitCents?: number } = {}) => {
    const repo = app.s.finance(userId);
    await repo.upsertAccount({ id, connectionId, provider: "enablebanking", externalId: id, identity: null, name: id, iban: null, currency: "EUR", type, ...more });
    await repo.setAccountBalance(id, balanceCents, NOW.toISOString());
  };
  await bank(app.adminId, "c-aino", "ESIMERKKIPANKKI");
  await account(app.adminId, "a-chk", "checking", "c-aino", 251_700);
  await account(app.adminId, "a-card", "credit_card", "c-aino", -120_000, { cardMask: "•••• 1234", creditLimitCents: 500_000 });
  await bank(eero.id, "c-eero", "TOINEN ESIMERKKIPANKKI");
  await account(eero.id, "e-card", "credit_card", "c-eero", -50_000, { cardMask: "•••• 5678", creditLimitCents: 300_000 });
  await account(eero.id, "e-hidden", "credit_card", "c-eero", -70_000, { cardMask: "•••• 9999", creditLimitCents: 700_000 });
  await account(eero.id, "e-chk", "checking", "c-eero", 40_000);
  await account(eero.id, "e-secret", "savings", "c-eero", 12_345);
  await account(eero.id, "e-loan", "loan", "c-eero", -900_000);
  // a loan a member typed in is his own, whatever the household shares
  const loan = { lender: "ESIMERKKIRAHOITUS OY", kind: "consumer", balanceDate: "2026-10-01" };
  expect((await app.admin.call("POST", "/api/loans", { ...loan, name: "Ainon laina", balanceCents: 400_000 })).status).toBe(200);
  expect((await eero.call("POST", "/api/loans", { ...loan, name: "Eeron laina", balanceCents: 650_000 })).status).toBe(200);
  await bank(maija.id, "c-maija", "VIERAS ESIMERKKIPANKKI");
  await account(maija.id, "m-card", "credit_card", "c-maija", -10_000, { cardMask: "•••• 0000", creditLimitCents: 111_100 });
  await app.s.household.share(eero.id, "e-card", app.adminId);
  await app.s.household.share(eero.id, "e-chk", app.adminId);
  const holdings = async (who: Client, scope: "own" | "household") => {
    const report = await who.call("GET", `/api/reports?reports=balances&scope=${scope}`);
    const dashboard = await who.call("GET", `/api/dashboard?scope=${scope}`);
    expect(report.status).toBe(200);
    expect(dashboard.status).toBe(200);
    // one answer in two places
    expect(withoutReconcile(dashboard.body.holdings)).toEqual(report.body.balances.holdings);
    return { holdings: report.body.balances.holdings, text: JSON.stringify([report.body, dashboard.body]) };
  };
  return { ...app, eero, maija, holdings };
}

/** The dashboard's accounts and cards also carry the reconcile word; the report's do not. */
const withoutReconcile = (h: { accounts: object[]; cards: object[] }) => ({
  ...h,
  accounts: h.accounts.map(({ reconcile: _reconcile, ...a }: any) => a),
  cards: h.cards.map(({ reconcile: _reconcile, ...c }: any) => c),
});

describe("holdings in the answers", () => {
  it("the bank, mask and limit stored for an account reach the report and the first page", async () => {
    const { admin, adminId, holdings } = await households();
    const { holdings: h } = await holdings(admin, "own");
    // an account one member linked and nobody said more about is that member's: the row names who uses it
    const use = { source: "owner", users: [{ userId: adminId, label: "Aino", weight: 1 }] };
    expect(h.cards).toEqual([
      { id: "a-card", name: "a-card", bank: "ESIMERKKIPANKKI", ownerName: null, mask: "•••• 1234", limitCents: 500_000, usedCents: 120_000, freeCents: 380_000, overCents: 0, balanceAt: "2026-10-09", use },
    ]);
    expect(h.accounts).toMatchObject([{ id: "a-chk", type: "checking", bank: "ESIMERKKIPANKKI", balanceCents: 251_700 }]);
    expect(h.loans).toMatchObject([{ name: "Ainon laina", source: "typed", leftCents: 400_000, ownerName: null }]);
  });

  it("another household's accounts, masks and limits are in none of the answers", async () => {
    const { admin, maija, holdings } = await households();
    for (const scope of ["own", "household"] as const) {
      const { text } = await holdings(admin, scope);
      for (const secret of ["m-card", "•••• 0000", "111100", "VIERAS"]) expect(text, `${scope}: ${secret}`).not.toContain(secret);
    }
    // and Maija sees her own card alone, in a household view too
    const { holdings: hers } = await holdings(maija, "household");
    expect(hers.cards.map((c: { id: string }) => c.id)).toEqual(["m-card"]);
  });

  it("a member's card that was not shared stays out of the household view; the shared one comes without the owner's bank", async () => {
    const { admin, eero, holdings } = await households();
    const own = await holdings(admin, "own");
    expect(own.holdings.cards.map((c: { id: string }) => c.id)).toEqual(["a-card"]);

    const { holdings: h, text } = await holdings(admin, "household");
    expect(h.cards.map((c: { id: string }) => c.id)).toEqual(["a-card", "e-card"]);
    expect(h.cards[1]).toEqual({
      id: "e-card", name: "e-card (Eero)", bank: null, ownerName: "Eero", mask: "•••• 5678", limitCents: 300_000, usedCents: 50_000, freeCents: 250_000, overCents: 0, balanceAt: "2026-10-09",
      use: { source: "owner", users: [{ userId: eero.id, label: "Eero", weight: 1 }] },
    });
    expect(h.accounts.map((a: { id: string; name: string; bank: string | null; ownerName: string | null; balanceCents: number }) => [a.id, a.name, a.bank, a.ownerName, a.balanceCents])).toEqual([
      ["a-chk", "a-chk", "ESIMERKKIPANKKI", null, 251_700],
      ["e-chk", "e-chk (Eero)", null, "Eero", 40_000],
    ]);
    // what Eero kept to himself, his typed loan and the bank of his connection are in no answer
    expect(h.loans.map((l: { name: string }) => l.name)).toEqual(["Ainon laina"]);
    for (const secret of ["e-hidden", "•••• 9999", "700000", "e-secret", "12345", "e-loan", "900000", "Eeron laina", "650000", "TOINEN ESIMERKKIPANKKI"]) expect(text, secret).not.toContain(secret);
  });

  it("a member nothing is shared with gets nothing of another member, in either view, and a share that ends takes the card out", async () => {
    const { admin, eero, s, adminId, holdings } = await households();
    // Eero has Aino's accounts shared with nobody: his household view is his own
    for (const scope of ["own", "household"] as const) {
      const { holdings: h, text } = await holdings(eero, scope);
      expect(h.cards.map((c: { id: string }) => c.id), scope).toEqual(["e-card", "e-hidden"]);
      expect(h.accounts.map((a: { id: string }) => a.id), scope).toEqual(["e-chk", "e-secret"]);
      expect(h.loans.map((l: { name: string }) => l.name), scope).toEqual(["Eeron laina", "e-loan"]);
      for (const secret of ["a-card", "a-chk", "•••• 1234", "500000", "251700", "Ainon laina", "400000", "\"ESIMERKKIPANKKI\""]) expect(text, `${scope}: ${secret}`).not.toContain(secret);
    }
    await s.household.unshare(eero.id, "e-card", adminId);
    const { holdings: h, text } = await holdings(admin, "household");
    expect(h.cards.map((c: { id: string }) => c.id)).toEqual(["a-card"]);
    expect(text).not.toContain("•••• 5678");
  });
});
