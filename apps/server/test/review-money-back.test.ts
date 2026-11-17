/**
 * Tarkistettavat's question of money a merchant may owe back (services/review-money-back.ts): a charge made twice and a
 * charge after Lopetettu, one item each, the most money first. Pyydän hyvityksen is the mark `in_use` on the alert and
 * brings the item back once after 30 days with the day it was asked, Veloitus on oikein is `dismissed`, and a refund
 * that lands closes it. Only the member's own rows. Made-up merchants and sums; the test clock is 9.10.2026.
 */
import type { AccountType } from "@banking/core";
import { describe, expect, it } from "vitest";
import { reprocess } from "../src/services/enrich.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { setupApp } from "./helpers.ts";

type Item = { id: string; kind: string; cents: number; [field: string]: unknown };
type Caller = { call: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }> };
type App = Awaited<ReturnType<typeof setupApp>>;

const queue = async (c: Caller) => ((await c.call("GET", "/api/review")).body.items as Item[]).filter((i) => i.kind === "money_back");

const account = async (t: App, userId: string, id: string, type: AccountType = "checking") => {
  const repo = t.s.finance(userId);
  await repo.upsertAccount({ id, connectionId: null, provider: "csv", externalId: null, identity: null, name: id, iban: null, currency: "EUR", type });
  await reprocess(repo, t.s.settings);
};

/** A row of the bank; `n` tells identical rows apart, which the bank does with its own reference. */
const raw = (bookingDate: string, amountCents: number, counterparty: string, n = 0) => ({
  externalId: `${bookingDate}|${amountCents}|${counterparty}|${n}`, bookingDate, valueDate: null, amountCents, currency: "EUR", status: "booked" as const, counterparty, counterpartyIban: null, description: null, reference: null, mcc: null
});

const load = async (t: App, userId: string, id: string, rows: ReturnType<typeof raw>[]) => {
  await account(t, userId, id);
  const repo = t.s.finance(userId);
  await ingestTransactions(repo, id, rows, "enablebanking");
  await reprocess(repo, t.s.settings);
};

const twice = (day: string, cents: number, name: string) => [raw(day, cents, name, 1), raw(day, cents, name, 2)];

describe("the question of money a merchant may owe back", () => {
  it("asks of a charge made twice, what the merchant owes and the rows of both", async () => {
    const t = await setupApp();
    await load(t, t.adminId, "chk", twice("2026-09-20", -16_743, "Verkkokauppa Oy"));
    const [item, ...rest] = await queue(t.admin);
    expect(rest).toEqual([]);
    expect(item).toMatchObject({ kind: "money_back", cents: 16_743, merchant: "Verkkokauppa", reason: "double", count: 2, lastDate: "2026-09-20", askedOn: null, rowCount: 2 });
    expect(item!.subject).toBe(`alert:${String(item!.id).replace(/^money_back:/, "")}`);
    expect((item!.rows as unknown[]).length).toBe(2);
  });

  it("asks nothing of a pair under 20 euros or of a merchant that does it routinely", async () => {
    const t = await setupApp();
    await load(t, t.adminId, "chk", [
      ...twice("2026-09-20", -1_990, "Pikku Kioski"),
      ...twice("2026-07-03", -2_400, "Elokuvateatteri"),
      ...twice("2026-08-07", -2_400, "Elokuvateatteri"),
      ...twice("2026-09-11", -2_400, "Elokuvateatteri"),
    ]);
    expect(await queue(t.admin)).toEqual([]);
  });

  it("goes when the merchant pays one of them back", async () => {
    const t = await setupApp();
    await load(t, t.adminId, "chk", twice("2026-09-20", -16_743, "Verkkokauppa Oy"));
    expect(await queue(t.admin)).toHaveLength(1);
    await ingestTransactions(t.s.finance(t.adminId), "chk", [raw("2026-09-27", 16_743, "Verkkokauppa Oy")], "enablebanking");
    await reprocess(t.s.finance(t.adminId), t.s.settings);
    expect(await queue(t.admin)).toEqual([]);
  });

  it("asks of a charge after Lopetettu, once a charge comes after the mark", async () => {
    const t = await setupApp();
    const monthly = ["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"].map((d) => raw(d, -5_900, "Elixia"));
    await load(t, t.adminId, "chk", monthly);
    await t.s.finance(t.adminId).setMarks(["merchant:Elixia"], "cancelled", "2026-09-15T10:00:00+03:00");
    expect(await queue(t.admin)).toEqual([expect.objectContaining({ merchant: "Elixia", reason: "cancelled", cents: 5_900, count: 1, lastDate: "2026-10-01" })]);
  });

  it("orders the items by the money, the most first", async () => {
    const t = await setupApp();
    await load(t, t.adminId, "chk", [...twice("2026-09-25", -2_500, "Kahvila"), ...twice("2026-09-01", -9_000, "Verkkokauppa Oy")]);
    expect((await queue(t.admin)).map((i) => [i.merchant, i.cents])).toEqual([["Verkkokauppa", 9_000], ["Kahvila", 2_500]]);
  });

  it("Pyydän hyvityksen hides it, and after 30 days it comes back once with the day it was asked", async () => {
    const t = await setupApp();
    await load(t, t.adminId, "chk", twice("2026-09-20", -16_743, "Verkkokauppa Oy"));
    const [item] = await queue(t.admin);
    expect((await t.admin.call("PUT", "/api/marks", { subject: item!.subject, mark: "in_use" })).status).toBe(200);
    expect(await queue(t.admin)).toEqual([]);
    // asked on 9.9.: the wait is over on the test clock's day
    await t.s.finance(t.adminId).setMarks([item!.subject as string], "in_use", "2026-09-09T10:00:00+03:00");
    expect(await queue(t.admin)).toEqual([expect.objectContaining({ id: item!.id, askedOn: "2026-09-09" })]);
    // the second answer closes it for good
    expect((await t.admin.call("PUT", "/api/marks", { subject: item!.subject, mark: "cancelled" })).status).toBe(200);
    expect(await queue(t.admin)).toEqual([]);
  });

  it("Veloitus on oikein closes it, for that charge alone", async () => {
    const t = await setupApp();
    await load(t, t.adminId, "chk", [...twice("2026-09-20", -16_743, "Verkkokauppa Oy"), ...twice("2026-09-22", -3_000, "Kahvila")]);
    const [first, second] = await queue(t.admin);
    expect((await t.admin.call("PUT", "/api/marks", { subject: first!.subject, mark: "dismissed" })).status).toBe(200);
    expect((await queue(t.admin)).map((i) => i.id)).toEqual([second!.id]);
  });

  it("is the member's own: another member's charges are not asked of the first user", async () => {
    const t = await setupApp();
    const ville = await t.member("ville", "Ville");
    await load(t, ville.id, "v-chk", twice("2026-09-20", -16_743, "Verkkokauppa Oy"));
    await t.s.household.share(ville.id, "v-chk", t.adminId);
    expect(await queue(t.admin)).toEqual([]);
    expect(await queue(ville)).toHaveLength(1);
  });
});
