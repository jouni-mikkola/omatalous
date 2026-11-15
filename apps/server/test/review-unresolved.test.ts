/**
 * Tarkistettavat's notice of cards whose payer the rows do not show (services/review-unresolved.ts), with the
 * dashboard's tile line beside it. "Älä muistuta tästä enää" is a mark `dismissed` on the cards it names: it holds
 * until a card joins that it did not name, whatever the debts do. A card paid from the counted accounts and from others,
 * and a balance no row proves, are no notice. Made-up names and sums; the test clock is 9.10.2026.
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
type Setup = Awaited<ReturnType<typeof cardWithoutPayer>>;

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

const notices = async (t: Setup) => ((await t.admin.call("GET", "/api/review")).body.items as Item[]).filter((i) => i.kind === "unresolved");
const aheadOf = async (t: Setup) => (await t.admin.call("GET", "/api/ahead")).body.ahead;

/** A second card with no payer seen, owing 100 €. */
async function addSecondCard(t: Setup) {
  const repo = t.s.finance(t.adminId);
  await repo.upsertAccount({ id: "card2", connectionId: null, provider: "csv", externalId: null, identity: null, name: "Toinen kortti", iban: "FI4950009420028731", currency: "EUR", type: "credit_card" });
  await ingestTransactions(repo, "card2", [raw("2026-10-04", -10, "KIOSKI ESIMERKKI", "KORTTIOSTO")], "csv");
  await repo.setAccountBalance("card2", -10_000, "2026-10-09T06:00:00.000Z");
  await reprocess(repo, t.s.settings);
}

describe("the notice of cards whose payer is not seen", () => {
  it("names a card nobody is seen to pay by its debt, and the tile says the same debt", async () => {
    const t = await cardWithoutPayer();
    expect(await notices(t)).toEqual([expect.objectContaining({ id: "unresolved:card_payer_unseen", reason: "card_payer_unseen", names: ["Luottokortti"], cents: 23_000, subject: "question:unresolved:card_payer_unseen:card" })]);
    const ahead = await aheadOf(t);
    expect(ahead.balance.unresolved).toEqual([expect.objectContaining({ reason: "card_payer_unseen", cardId: "card", cents: 23_000 })]);
    expect(ahead.balance.cardDebtCents).toBe(23_000);
  });

  it("takes a debt larger than the money off whole, and the figure goes below zero", async () => {
    const t = await cardWithoutPayer();
    await t.admin.call("PATCH", "/api/accounts/card", { balanceCents: -300_000 });
    const { balance, totals } = await aheadOf(t);
    expect(balance.cardDebtCents).toBe(300_000);
    expect(balance.cardDebtCents).toBeGreaterThan(balance.startCents);
    expect(balance.freeCents).toBe(balance.startCents - totals.leavingCents - balance.cardDebtCents);
    expect(balance.freeCents).toBeLessThan(0);
  });

  it("goes when a payment from the pool's account is seen, and the figure has nothing unresolved", async () => {
    const t = await cardWithoutPayer();
    const repo = t.s.finance(t.adminId);
    await ingestTransactions(repo, "chk", [raw("2026-10-01", -100, "Luottokortti", "KORTIN MAKSU", "FI1410093000123458")], "csv");
    await ingestTransactions(repo, "card", [{ ...raw("2026-10-01", 100, "Maksu", "KORTIN MAKSU"), counterpartyIban: "FI2112345600000785" }], "csv");
    await reprocess(repo, t.s.settings);
    expect(await notices(t)).toEqual([]);
    expect((await aheadOf(t)).balance.unresolved).toEqual([]);
  });

  it("stays away after the dismissal when the debt swings, and returns when a card joins that it did not name", async () => {
    const t = await cardWithoutPayer();
    const [item] = await notices(t);
    expect((await t.admin.call("PUT", "/api/marks", { subject: item!.subject, mark: "dismissed" })).status).toBe(200);
    expect(await notices(t)).toEqual([]);
    // 230 € to 900 €: the amount is no part of the key, so the notice stays away
    expect((await t.admin.call("PATCH", "/api/accounts/card", { balanceCents: -90_000 })).status).toBe(200);
    expect(await notices(t)).toEqual([]);
    // a second card with no payer seen is a card the dismissal did not name
    await addSecondCard(t);
    expect(await notices(t)).toEqual([expect.objectContaining({ names: ["Luottokortti", "Toinen kortti"], cents: 100_000, subject: "question:unresolved:card_payer_unseen:card,card2" })]);
  });

  it("is no notice for a card paid from the counted accounts and from others, which Miksi? still tells", async () => {
    const t = await cardWithoutPayer();
    const repo = t.s.finance(t.adminId);
    await repo.upsertAccount({ id: "sav", connectionId: null, provider: "csv", externalId: null, identity: null, name: "Säästötili", iban: "FI4950009420028731", currency: "EUR", type: "savings" });
    await repo.setAccountBalance("sav", 900_000, "2026-10-09T06:00:00.000Z");
    await ingestTransactions(repo, "chk", [raw("2026-10-01", -100, "Luottokortti", "KORTIN MAKSU", "FI1410093000123458")], "csv");
    await ingestTransactions(repo, "sav", [raw("2026-10-02", -70, "Luottokortti", "KORTIN MAKSU", "FI1410093000123458")], "csv");
    await ingestTransactions(repo, "card", [{ ...raw("2026-10-01", 100, "Maksu", "KORTIN MAKSU"), counterpartyIban: "FI2112345600000785" }, { ...raw("2026-10-02", 70, "Maksu", "KORTIN MAKSU"), counterpartyIban: "FI4950009420028731" }], "csv");
    await reprocess(repo, t.s.settings);
    expect(await notices(t)).toEqual([]);
    expect((await aheadOf(t)).balance.unresolved).toEqual([expect.objectContaining({ reason: "card_payer_mixed", cardId: "card" })]);
  });

  it("is no notice for a balance no row can check", async () => {
    const t = await cardWithoutPayer();
    expect((await notices(t)).map((i) => i.reason)).toEqual(["card_payer_unseen"]);
  });

  it("takes no answer but the dismissal", async () => {
    const t = await cardWithoutPayer();
    const [item] = await notices(t);
    for (const mark of ["in_use", "cancelled"]) expect((await t.admin.call("PUT", "/api/marks", { subject: item!.subject, mark })).status, mark).toBe(400);
    expect((await t.admin.call("PUT", "/api/marks", { subject: "question:unresolved:nothing:card", mark: "dismissed" })).status).toBe(400);
    expect((await t.admin.call("PUT", "/api/marks", { subject: "question:unresolved:card_payer_unseen@23000", mark: "dismissed" })).status).toBe(400);
  });
});
