/**
 * Tarkistettavat's notice of cards whose payer the rows do not show (services/review-unresolved.ts), with the
 * dashboard's tile line beside it. "Älä muistuta tästä enää" is a mark `dismissed` per card it names: it holds
 * until a card joins that has none, whatever the debts do, and a dismissal an earlier version stored for a set still counts. A card paid from the counted accounts and from others,
 * and a balance no row proves, are no notice. Made-up names and sums; the test clock is 9.10.2026.
 */
import { type RawTransaction, unresolvedSubjects } from "@banking/core";
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
    expect(await notices(t)).toEqual([expect.objectContaining({ id: "unresolved:card_payer_unseen", reason: "card_payer_unseen", names: ["Luottokortti"], cents: 23_000, subjects: unresolvedSubjects("card_payer_unseen", ["card"]) })]);
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
    expect((await t.admin.call("PUT", "/api/marks", { subjects: item!.subjects, mark: "dismissed" })).status).toBe(200);
    expect(await notices(t)).toEqual([]);
    // 230 € to 900 €: the amount is no part of the key, so the notice stays away
    expect((await t.admin.call("PATCH", "/api/accounts/card", { balanceCents: -90_000 })).status).toBe(200);
    expect(await notices(t)).toEqual([]);
    // a second card with no payer seen is a card the dismissal did not name
    await addSecondCard(t);
    expect(await notices(t)).toEqual([expect.objectContaining({ names: ["Luottokortti", "Toinen kortti"], cents: 100_000, subjects: unresolvedSubjects("card_payer_unseen", ["card", "card2"]) })]);
  });

  it("stays away when a dismissed card is paid off and leaves the notice", async () => {
    const t = await cardWithoutPayer();
    await addSecondCard(t);
    const [item] = await notices(t);
    expect(item!.subjects).toHaveLength(2);
    expect((await t.admin.call("PUT", "/api/marks", { subjects: item!.subjects, mark: "dismissed" })).status).toBe(200);
    expect(await notices(t)).toEqual([]);
    // the first card gets a payment from the checking account: it is proven and no longer in the notice
    const repo = t.s.finance(t.adminId);
    await ingestTransactions(repo, "chk", [raw("2026-10-01", -100, "Luottokortti", "KORTIN MAKSU", "FI1410093000123458")], "csv");
    await ingestTransactions(repo, "card", [{ ...raw("2026-10-01", 100, "Maksu", "KORTIN MAKSU"), counterpartyIban: "FI2112345600000785" }], "csv");
    await reprocess(repo, t.s.settings);
    expect((await aheadOf(t)).balance.unresolved.map((c: { cardId: string }) => c.cardId)).toEqual(["card2"]);
    expect(await notices(t)).toEqual([]);
  });

  it("stays away on a dismissal an earlier version stored for the whole set, and returns for a card it did not name", async () => {
    const t = await cardWithoutPayer();
    await addSecondCard(t);
    const repo = t.s.finance(t.adminId);
    await repo.setMark("question:unresolved:card_payer_unseen:card,card2", "dismissed", "2026-10-01");
    expect(await notices(t)).toEqual([]);
    await repo.upsertAccount({ id: "card3", connectionId: null, provider: "csv", externalId: null, identity: null, name: "Kolmas kortti", iban: null, currency: "EUR", type: "credit_card" });
    await ingestTransactions(repo, "card3", [raw("2026-10-04", -10, "KIOSKI ESIMERKKI", "KORTTIOSTO")], "csv");
    await repo.setAccountBalance("card3", -10_000, "2026-10-09T06:00:00.000Z");
    await reprocess(repo, t.s.settings);
    expect((await notices(t))[0]!.names).toEqual(["Luottokortti", "Toinen kortti", "Kolmas kortti"]);
  });

  it("takes the dismissal of a notice that names many cards, and holds it", async () => {
    const t = await cardWithoutPayer();
    const repo = t.s.finance(t.adminId);
    // 12 ids of 28 characters: the ids alone would pass the 200 characters a subject may have
    const ids = Array.from({ length: 12 }, (_, i) => `credit-card-number-${String(i).padStart(2, "0")}-abcd`);
    for (const id of ids) {
      await repo.upsertAccount({ id, connectionId: null, provider: "csv", externalId: null, identity: null, name: `Kortti ${id}`, iban: null, currency: "EUR", type: "credit_card" });
      await ingestTransactions(repo, id, [raw("2026-10-04", -10, "KIOSKI ESIMERKKI", "KORTTIOSTO")], "csv");
      await repo.setAccountBalance(id, -10_000, "2026-10-09T06:00:00.000Z");
    }
    await reprocess(repo, t.s.settings);
    const [item] = await notices(t);
    expect(item!.names).toHaveLength(13);
    expect([...(item!.subjects as string[])].sort()).toEqual(unresolvedSubjects("card_payer_unseen", ["card", ...ids]));
    expect((await t.admin.call("PUT", "/api/marks", { subjects: item!.subjects, mark: "dismissed" })).status).toBe(200);
    expect(await notices(t)).toEqual([]);
  });

  it("writes the marks of 60 long ids in one request, each within the 200 characters of a subject", async () => {
    const t = await cardWithoutPayer();
    const ids = Array.from({ length: 60 }, (_, i) => `account-${String(i).padStart(2, "0")}-${"x".repeat(53)}`);
    const subjects = unresolvedSubjects("card_payer_unseen", ids);
    const res = await t.admin.call("PUT", "/api/marks", { subjects, mark: "dismissed" });
    expect(res.status).toBe(200);
    const stored = (res.body.marks as { subject: string; mark: string }[]).filter((m) => m.subject.startsWith("question:unresolved:"));
    expect(stored.map((m) => m.subject).sort()).toEqual([...subjects].sort());
    for (const m of stored) expect(m.subject.length - "question:".length).toBeLessThanOrEqual(200);
  });

  it("writes none of the marks when one subject of the list is refused", async () => {
    const t = await cardWithoutPayer();
    const [good] = unresolvedSubjects("card_payer_unseen", ["card"]);
    const res = await t.admin.call("PUT", "/api/marks", { subjects: [good, "question:unresolved:nothing:card"], mark: "dismissed" });
    expect(res.status).toBe(400);
    expect(await notices(t)).toHaveLength(1);
  });

  it("takes one of subject and subjects, a list within bounds, and no list to take a mark away", async () => {
    const t = await cardWithoutPayer();
    const [one] = unresolvedSubjects("card_payer_unseen", ["card"]);
    const status = async (payload: unknown) => (await t.admin.call("PUT", "/api/marks", payload)).status;
    expect(await status({ subject: one, subjects: [one], mark: "dismissed" })).toBe(400);
    expect(await status({ mark: "dismissed" })).toBe(400);
    expect(await status({ subjects: [], mark: "dismissed" })).toBe(400);
    expect(await status({ subjects: unresolvedSubjects("card_payer_unseen", Array.from({ length: 201 }, (_, i) => `c${i}`)), mark: "dismissed" })).toBe(400);
    expect(await status({ subjects: [one, "question:unresolved:card_payer_unseen:card2"], mark: null })).toBe(400);
    expect(await status({ subjects: [one], mark: "dismissed" })).toBe(200);
    expect(await status({ subjects: [one], mark: null })).toBe(200);
    expect(await notices(t)).toHaveLength(1);
  });

  it("never writes a subject of several cards, but takes one an earlier version stored away", async () => {
    const t = await cardWithoutPayer();
    const old = "question:unresolved:card_payer_unseen:card,card2";
    expect(await t.admin.call("PUT", "/api/marks", { subject: old, mark: "dismissed" }).then((r) => r.status)).toBe(400);
    await t.s.finance(t.adminId).setMark(old, "dismissed", "2026-10-01");
    expect(await notices(t)).toEqual([]);
    expect((await t.admin.call("PUT", "/api/marks", { subject: old, mark: null })).status).toBe(200);
    expect(await notices(t)).toHaveLength(1);
  });

  it("is no notice for a card paid from the counted accounts and from others", async () => {
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
    for (const mark of ["in_use", "cancelled"]) expect((await t.admin.call("PUT", "/api/marks", { subject: (item!.subjects as string[])[0], mark })).status, mark).toBe(400);
    expect((await t.admin.call("PUT", "/api/marks", { subject: "question:unresolved:nothing:card", mark: "dismissed" })).status).toBe(400);
    expect((await t.admin.call("PUT", "/api/marks", { subject: "question:unresolved:card_payer_unseen@23000", mark: "dismissed" })).status).toBe(400);
  });
});
