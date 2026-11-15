/**
 * Tarkistettavat's notices of figures the app cannot prove (services/review-unresolved.ts): a card whose payer the
 * rows do not show, with the dashboard's tile line beside it. Ohita is a mark `dismissed` that holds until the amount
 * moves a quarter. Made-up names and sums; the test clock is 9.10.2026.
 */
import { type RawTransaction } from "@banking/core";
import { describe, expect, it } from "vitest";
import { reprocess } from "../src/services/enrich.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { setupApp } from "./helpers.ts";

const raw = (bookingDate: string, euros: number, counterparty: string, description: string, counterpartyIban: string | null = null): RawTransaction => ({
  externalId: null, bookingDate, valueDate: null, amountCents: Math.round(euros * 100), currency: "EUR", status: "booked",
  counterparty, counterpartyIban, description, reference: null, mcc: null,
});

type Item = { id: string; kind: string; cents: number; [field: string]: unknown };

/** A checking account with 2 500 € and a card that owes 230 €, no payment to the card in any row. */
async function cardWithoutPayer() {
  const t = await setupApp();
  const repo = t.s.finance(t.adminId);
  await repo.upsertAccount({ id: "chk", connectionId: null, provider: "csv", externalId: null, identity: null, name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" });
  await repo.upsertAccount({ id: "card", connectionId: null, provider: "csv", externalId: null, identity: null, name: "Luottokortti", iban: "FI1410093000123458", currency: "EUR", type: "credit_card" });
  await ingestTransactions(repo, "chk", [raw("2026-10-02", -42.1, "K-MARKET ESIMERKKI", "KORTTIOSTO"), raw("2026-09-15", 3200, "ESIMERKKITYÖNANTAJA OY", "PALKKA")], "csv");
  await ingestTransactions(repo, "card", [raw("2026-10-03", -25, "KAHVILA ESIMERKKI", "KORTTIOSTO")], "csv");
  await repo.setAccountBalance("chk", 250_000, "2026-10-09T06:00:00.000Z");
  await repo.setAccountBalance("card", -23_000, "2026-10-09T06:00:00.000Z");
  await reprocess(repo, t.s.settings);
  return t;
}

describe("the notices of figures that are not proven", () => {
  /** The cards' notices: the one balance of the checking account is a notice of its own (`too_few`), which another test holds. */
  const notices = async (t: Awaited<ReturnType<typeof cardWithoutPayer>>) => ((await t.admin.call("GET", "/api/review")).body.items as Item[]).filter((i) => i.kind === "unresolved" && String(i.reason).startsWith("card_payer"));

  it("names a card nobody is seen to pay by its debt, and the tile says the same debt", async () => {
    const t = await cardWithoutPayer();
    expect(await notices(t)).toEqual([expect.objectContaining({ id: "unresolved:card_payer_unseen", reason: "card_payer_unseen", names: ["Luottokortti"], cents: 23_000, subject: "question:unresolved:card_payer_unseen@23000" })]);
    const { ahead } = (await t.admin.call("GET", "/api/ahead")).body;
    expect(ahead.balance.unresolved).toEqual([expect.objectContaining({ reason: "card_payer_unseen", cardId: "card", cents: 23_000 })]);
    // the debt still comes off whole, and never more than the pool holds
    expect(ahead.balance.cardDebtCents).toBe(23_000);
    expect(ahead.balance.cardDebtCents).toBeLessThanOrEqual(ahead.balance.startCents);
  });

  it("goes when a payment from the pool's account is seen, and the figure has nothing unresolved", async () => {
    const t = await cardWithoutPayer();
    const repo = t.s.finance(t.adminId);
    await ingestTransactions(repo, "chk", [raw("2026-10-01", -100, "Luottokortti", "KORTIN MAKSU", "FI1410093000123458")], "csv");
    await ingestTransactions(repo, "card", [{ ...raw("2026-10-01", 100, "Maksu", "KORTIN MAKSU"), counterpartyIban: "FI2112345600000785" }], "csv");
    await reprocess(repo, t.s.settings);
    expect(await notices(t)).toEqual([]);
    expect((await t.admin.call("GET", "/api/ahead")).body.ahead.balance.unresolved).toEqual([]);
  });

  it("stays away after Ohita while the amount holds, and returns when it has moved a quarter", async () => {
    const t = await cardWithoutPayer();
    const [item] = await notices(t);
    expect((await t.admin.call("PUT", "/api/marks", { subject: item!.subject, mark: "dismissed" })).status).toBe(200);
    expect(await notices(t)).toEqual([]);
    // 230 € to 250 €: less than a quarter, the notice stays set aside
    expect((await t.admin.call("PATCH", "/api/accounts/card", { balanceCents: -25_000 })).status).toBe(200);
    expect(await notices(t)).toEqual([]);
    // 230 € to 400 €: more than a quarter, it returns with the new amount
    expect((await t.admin.call("PATCH", "/api/accounts/card", { balanceCents: -40_000 })).status).toBe(200);
    expect(await notices(t)).toEqual([expect.objectContaining({ cents: 40_000, subject: "question:unresolved:card_payer_unseen@40000" })]);
  });

  it("names a balance no row can check by the figure it starts from", async () => {
    const t = await cardWithoutPayer();
    const items = ((await t.admin.call("GET", "/api/review")).body.items as Item[]).filter((i) => i.kind === "unresolved" && i.reason === "too_few");
    // the accounts that hold a single balance each, added up as their sizes, whatever their sign
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "unresolved:too_few", names: expect.arrayContaining(["Käyttötili"]) });
    expect(items[0]!.cents).toBe((items[0]!.names as string[]).length === 2 ? 273_000 : 250_000);
  });

  it("takes no answer but Ohita", async () => {
    const t = await cardWithoutPayer();
    const [item] = await notices(t);
    for (const mark of ["in_use", "cancelled"]) expect((await t.admin.call("PUT", "/api/marks", { subject: item!.subject, mark })).status, mark).toBe(400);
    expect((await t.admin.call("PUT", "/api/marks", { subject: "question:unresolved:nothing@100", mark: "dismissed" })).status).toBe(400);
  });
});
