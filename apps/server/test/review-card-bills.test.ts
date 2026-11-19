/**
 * A card the household pays the bills of and has not connected, as a row of Täydennä lainat (services/review-loan-terms.ts):
 * one row for the card with a month of its bills, gone once the debt is saved as a loan of kind card, linked to the bills or
 * not, or the household says Ei ole velan maksu. Made-up issuer and sums; the test clock is 9.10.2026.
 */
import { loanUnknownSubject, notLoanMark, type RawTransaction } from "@banking/core";
import { describe, expect, it } from "vitest";
import { reprocess } from "../src/services/enrich.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { setupApp } from "./helpers.ts";

type Item = { id: string; kind: string; cents: number; [field: string]: unknown };
type Debt = { id: string; source: string; key: string | null; [field: string]: unknown };

/** The rows of Täydennä lainat a user is asked, none when the item is not in the queue. */
const listed = (items: Item[]): Debt[] => (items.find((i) => i.kind === "loan_terms_list")?.debts as Debt[] | undefined) ?? [];

const MONTHS = [3, 4, 5, 6, 7, 8, 9].map((m) => `2026-${String(m).padStart(2, "0")}`);
const raw = (bookingDate: string, cents: number, counterparty: string): RawTransaction => ({
  externalId: null, bookingDate, valueDate: null, amountCents: cents, currency: "EUR", status: "booked",
  counterparty, counterpartyIban: null, description: null, reference: null, mcc: null,
});

/** A household whose card is not connected: its bills leave the checking account each month, a little different each time. */
async function household(payees = ["ESIMERKKIPANKKI KORTTI"]) {
  const t = await setupApp();
  const repo = t.s.finance(t.adminId);
  await repo.upsertAccount({ id: "chk", connectionId: null, provider: "csv", externalId: null, identity: null, name: "Käyttötili", iban: null, currency: "EUR", type: "checking" });
  for (const [p, payee] of payees.entries()) {
    await ingestTransactions(repo, "chk", MONTHS.map((m, i) => raw(`${m}-12`, -(40_000 - 10_000 * p + 1_000 * i), payee)), "csv");
  }
  await t.db.run("UPDATE transactions SET category = 'card_bill', category_source = 'user'");
  await reprocess(repo, t.s.settings);
  const cards = async () => listed((await t.admin.call("GET", "/api/review")).body.items as Item[]).filter((d) => d.source === "card_bill");
  return { ...t, cards };
}

describe("the question of a card that is not connected", () => {
  it("lists the card once, with a month of its bills and no balance, and asks the list first", async () => {
    const t = await household();
    const [card, ...more] = await t.cards();
    expect(more).toEqual([]);
    expect(card).toMatchObject({ name: "Esimerkkipankki Kortti", id: `card_bill:${card!.key}`, kind: "card", owedCents: null });
    expect(card!.monthlyCents as number).toBeGreaterThan(40_000);
    const items = (await t.admin.call("GET", "/api/review")).body.items as Item[];
    expect(items[0]).toMatchObject({ kind: "loan_terms_list", id: "loan-terms", noBalance: 1 });
  });

  it("goes with a card saved as a loan linked to its bills, and with Ei ole velan maksu", async () => {
    const t = await household();
    const [card] = await t.cards();
    const saved = await t.admin.call("POST", "/api/loans", { name: "Esimerkkikortti", kind: "card", balanceCents: 120_000, limitCents: 300_000, balanceDate: "2026-10-01", seriesKey: card!.key });
    expect(saved.status).toBe(200);
    expect(await t.cards()).toEqual([]);

    const u = await household();
    const [other] = await u.cards();
    expect((await u.admin.call("PUT", "/api/marks", notLoanMark({ key: other!.key as string }))).status).toBe(200);
    expect(await u.cards()).toEqual([]);
  });

  it("is not asked of a card already saved under Lainat with no link to its bills", async () => {
    const t = await household();
    const [card] = await t.cards();
    expect(card).toMatchObject({ savedCards: [] });
    const saved = await t.admin.call("POST", "/api/loans", { name: "Esimerkkikortti", kind: "card", balanceCents: 120_000, limitCents: 300_000, balanceDate: "2026-10-01" });
    expect(saved.status).toBe(200);
    expect(await t.cards()).toEqual([]);
  });

  it("keeps asking of the other card when the saved one is linked to the series it is", async () => {
    const t = await household(["ESIMERKKIPANKKI KORTTI", "TOINENPANKKI KORTTI"]);
    expect((await t.cards()).map((c) => c.key)).toHaveLength(2);
    const saved = await t.admin.call("POST", "/api/loans", { name: "Esimerkkikortti", kind: "card", balanceCents: 120_000, limitCents: 300_000, balanceDate: "2026-10-01" });
    expect(saved.status).toBe(200);
    const loan = saved.body.loan as { id: string };
    const [asked, ...rest] = await t.cards();
    expect(rest).toEqual([]);
    expect(asked).toMatchObject({ savedCards: [{ id: loan.id, name: "Esimerkkikortti" }] });
    // the answer links the saved loan to the card's series and leaves the other card asked
    const linked = await t.admin.call("PUT", `/api/loans/${loan.id}`, { name: "Esimerkkikortti", kind: "card", balanceCents: 120_000, limitCents: 300_000, balanceDate: "2026-10-01", seriesKey: asked!.key });
    expect(linked.status).toBe(200);
    const [other, ...none] = await t.cards();
    expect(none).toEqual([]);
    expect(other!.key).not.toBe(asked!.key);
    expect(other).toMatchObject({ savedCards: [] });
  });

  it("is not asked of another member, who has no such rows", async () => {
    const t = await household();
    const maija = await t.member("maija", "Maija");
    expect(listed((await maija.call("GET", "/api/review")).body.items as Item[])).toEqual([]);
  });

  it("goes with En tiedä at its monthly bill, and comes back once the bill rises by more than a tenth", async () => {
    const t = await household();
    const [card] = await t.cards();
    const said = Math.round((card!.monthlyCents as number) / 2);
    expect((await t.admin.call("PUT", "/api/marks", { subject: loanUnknownSubject(card!.monthlyCents as number, card!.key!), mark: "in_use" })).status).toBe(200);
    expect(await t.cards()).toEqual([]);
    const u = await household();
    expect((await u.admin.call("PUT", "/api/marks", { subject: loanUnknownSubject(said, card!.key!), mark: "in_use" })).status).toBe(200);
    expect(await u.cards()).toHaveLength(1);
  });
});

/**
 * Beside the card paid each month: one bill of a card that is not connected, and a connected card whose rows begin inside
 * the twelve complete months, with no bill.
 */
async function withGaps() {
  const t = await household();
  const repo = t.s.finance(t.adminId);
  await ingestTransactions(repo, "chk", [raw("2026-08-12", -30_000, "TOINENPANKKI KORTTI")], "csv");
  await t.db.run("UPDATE transactions SET category = 'card_bill', category_source = 'user'");
  await repo.upsertAccount({ id: "kortti", connectionId: null, provider: "csv", externalId: null, identity: null, name: "Kolmaspankki Gold", iban: null, currency: "EUR", type: "credit_card" });
  await ingestTransactions(repo, "kortti", ["2026-06-01", "2026-06-11", "2026-06-21"].map((d) => raw(d, -2_000, "ESIMERKKIKAUPPA")), "csv");
  await reprocess(repo, t.s.settings);
  const gaps = async () => listed((await t.admin.call("GET", "/api/review")).body.items as Item[]).filter((d) => d.source === "card_gap");
  return { ...t, gaps };
}

describe("the question of a card whose purchases are missing", () => {
  it("lists the card with one bill and the connected card beside the card paid each month, each once", async () => {
    const t = await withGaps();
    expect(await t.cards()).toHaveLength(1);
    const gaps = await t.gaps();
    expect(gaps.map((g) => g.name)).toEqual(["Toinenpankki Kortti", "Kolmaspankki Gold"]);
    const [loose, connected] = gaps;
    // a card that is not connected is connected, saved as a card loan by its bill's key, or its statement added
    expect(loose).toMatchObject({ id: `card_gap:${loose!.key}`, kind: "card", accountId: null, monthlyCents: null, owedCents: null, lastDate: "2026-08-12", missing: { cents: 30_000, since: null } });
    expect(loose!.key).toMatch(/^out:chk:/);
    // a connected card's debt is its account's: only its statement is asked, and its balance is not counted missing
    expect(connected).toMatchObject({ accountId: "kortti", monthlyCents: null, lastDate: null, missing: { cents: null, since: "2026-06-01" }, savedCards: [] });
    const item = ((await t.admin.call("GET", "/api/review")).body.items as Item[]).find((i) => i.kind === "loan_terms_list")!;
    expect(item.noBalance).toBe(2);
  });

  it("goes with En tiedä at its sum, and the card with one bill with a saved loan linked to it", async () => {
    const t = await withGaps();
    const [loose, connected] = await t.gaps();
    expect((await t.admin.call("PUT", "/api/marks", { subject: loanUnknownSubject(null, connected!.key!), mark: "in_use" })).status).toBe(200);
    expect((await t.gaps()).map((g) => g.name)).toEqual(["Toinenpankki Kortti"]);
    const saved = await t.admin.call("POST", "/api/loans", { name: "Toinenkortti", kind: "card", balanceCents: 50_000, limitCents: 200_000, balanceDate: "2026-10-01", seriesKey: loose!.key });
    expect(saved.status).toBe(200);
    expect(await t.gaps()).toEqual([]);
    const u = await withGaps();
    expect((await u.admin.call("PUT", "/api/marks", { subject: loanUnknownSubject(30_000, loose!.key!), mark: "in_use" })).status).toBe(200);
    expect((await u.gaps()).map((g) => g.name)).toEqual(["Kolmaspankki Gold"]);
  });
});
