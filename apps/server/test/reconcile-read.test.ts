/**
 * "Täsmää pankin saldoon" as the account list answers it: one `reconcile` field per account the viewer sees, worked out
 * from the account's own rows, its recorded history and the balances of its real account. Made-up household and sums.
 */
import { describe, expect, it } from "vitest";
import type { RawTransaction } from "@banking/core";
import { ingestTransactions } from "../src/services/ingest.ts";
import { setupApp } from "./helpers.ts";

/** The test clock is 9.10.2026. */
const BALANCES = [
  { ref: "2026-09-30", cents: 120_000 },
  { ref: "2026-10-07", cents: 188_750 },
];

const row = (bookingDate: string, amountCents: number, counterparty: string): RawTransaction => ({
  externalId: null, bookingDate, valueDate: bookingDate, amountCents, currency: "EUR", status: "booked", counterparty, counterpartyIban: null, description: null, reference: null, mcc: null,
});

/** Money out, money in, a refund and a bill between the two balances: they add up to 687,50. */
const ROWS = [
  row("2026-10-02", -4550, "KAUPPA A"),
  row("2026-10-03", -12000, "KENKAKAUPPA"),
  row("2026-10-04", 2500, "KENKAKAUPPA"),
  row("2026-10-05", 90000, "ESIMERKKI OY"),
  row("2026-10-06", -7200, "SAHKO"),
];

type Setup = Awaited<ReturnType<typeof setupApp>>;

/** A checking account of one user with the rows and the bank's balances given, linked as the bank would: the history asked from `asked`. */
async function account(app: Setup, userId: string, id: string, identity: string, rows: RawTransaction[], asked: string, balances = BALANCES, over: { type?: "checking" | "credit_card"; currency?: string } = {}) {
  const repo = app.s.finance(userId);
  await repo.upsertAccount({ id, connectionId: null, provider: "enablebanking", externalId: `ext-${id}`, identity, name: "Käyttötili", iban: null, currency: over.currency ?? "EUR", type: over.type ?? "checking" });
  await ingestTransactions(repo, id, rows, "enablebanking");
  await repo.recordHistory(id, asked, "default", "2026-09-01T06:00:00.000Z");
  for (const b of balances) {
    const day = new Date(Date.parse(`${b.ref}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    await repo.recordBalances(identity, day, `${day}T06:00:00.000Z`, [{ cents: b.cents, type: "CLBD", referenceDay: b.ref }]);
  }
}

const reconcileOf = async (client: Setup["admin"], accountId: string) => {
  const meta = (await client.call("GET", "/api/meta")).body;
  return [...meta.accounts, ...meta.sharedAccounts].find((a: { id: string }) => a.id === accountId)?.reconcile;
};

describe("the reconcile field of an account", () => {
  it("is proved when money in, out and a refund add up to the bank's change, and differs by one cent when they do not", async () => {
    const app = await setupApp();
    await account(app, app.adminId, "a-chk", "idn-chk", ROWS, "2026-09-01");
    expect(await reconcileOf(app.admin, "a-chk")).toEqual({
      type: "CLBD",
      status: "proved",
      reason: null,
      provedFrom: "2026-10-01",
      provedTo: "2026-10-07",
      lastMatchedTo: "2026-10-07",
      intervals: [{ fromDay: "2026-10-01", toDay: "2026-10-07", deltaCents: 68750, sumCents: 68750, diffCents: 0, state: "matched", mark: null, reason: null, hint: null }],
    });
    // the bank's last word on 7.10. was one cent higher
    await app.s.finance(app.adminId).recordBalances("idn-chk", "2026-10-08", "2026-10-08T09:00:00.000Z", [{ cents: 188_751, type: "CLBD", referenceDay: "2026-10-07" }]);
    expect(await reconcileOf(app.admin, "a-chk")).toMatchObject({ status: "differs", provedFrom: null, lastMatchedTo: null, intervals: [{ state: "differs", diffCents: 1 }] });
  });

  it("is null for a card and for an account in another currency, and says why when there is no proof", async () => {
    const app = await setupApp();
    await account(app, app.adminId, "a-card", "idn-card", ROWS, "2026-09-01", BALANCES, { type: "credit_card" });
    await account(app, app.adminId, "a-usd", "idn-usd", ROWS, "2026-09-01", BALANCES, { currency: "USD" });
    await account(app, app.adminId, "a-one", "idn-one", ROWS, "2026-09-01", BALANCES.slice(0, 1));
    expect(await reconcileOf(app.admin, "a-card")).toBeNull();
    expect(await reconcileOf(app.admin, "a-usd")).toBeNull();
    expect(await reconcileOf(app.admin, "a-one")).toMatchObject({ type: null, status: "unknown", reason: "too_few", intervals: [] });
  });

  it("holds an interval before the account row's own history as unknown: each copy of a joint account answers for its own rows", async () => {
    const app = await setupApp();
    const maija = await app.member("maija");
    // Matti's copy asked from 1.9. and holds every row; Maija's copy was linked 5.10. and holds the rows from then
    await account(app, app.adminId, "a-matti", "idn-joint", ROWS, "2026-09-01");
    await account(app, maija.id, "a-maija", "idn-joint", ROWS.slice(3), "2026-10-05");
    expect(await reconcileOf(app.admin, "a-matti")).toMatchObject({ status: "proved", provedFrom: "2026-10-01" });
    expect(await reconcileOf(maija, "a-maija")).toMatchObject({ status: "unknown", provedFrom: null, intervals: [{ state: "unknown", reason: "rows_start_later" }] });
  });

  it("is seen only for the accounts the viewer sees: another member's account is no answer until it is shared, and none once it is not", async () => {
    const app = await setupApp();
    const eero = await app.member("eero");
    await account(app, app.adminId, "a-chk", "idn-chk", ROWS, "2026-09-01");
    const meta = async () => (await eero.call("GET", "/api/meta")).body;
    expect((await meta()).accounts).toEqual([]);
    expect((await meta()).sharedAccounts).toEqual([]);
    expect(await reconcileOf(eero, "a-chk")).toBeUndefined();

    await app.admin.call("PUT", "/api/accounts/a-chk/shares/" + eero.id);
    expect(await reconcileOf(eero, "a-chk")).toEqual(await reconcileOf(app.admin, "a-chk"));
    expect(await reconcileOf(eero, "a-chk")).toMatchObject({ status: "proved" });

    await app.admin.call("DELETE", "/api/accounts/a-chk/shares/" + eero.id);
    expect((await meta()).sharedAccounts).toEqual([]);
  });

  it("reads and writes nothing: the stored balances, rows and the account's own balance are as they were", async () => {
    const app = await setupApp();
    await account(app, app.adminId, "a-chk", "idn-chk", ROWS, "2026-09-01");
    const snapshot = async () => JSON.stringify([
      await app.db.all("SELECT * FROM account_balances ORDER BY account_key, day, type"),
      await app.db.all("SELECT * FROM transactions ORDER BY id"),
      await app.db.all("SELECT * FROM account_history"),
    ]);
    const before = await snapshot();
    await reconcileOf(app.admin, "a-chk");
    expect(await snapshot()).toBe(before);
  });
});

describe("the demo household", () => {
  it("proves its checking account clean to the cent over its whole history; the savings account has only an available balance; the card is not reconciled", async () => {
    const app = await setupApp();
    expect((await app.admin.call("POST", "/api/demo")).status).toBe(200);
    const accounts = (await app.admin.call("GET", "/api/meta")).body.accounts as { type: string; reconcile: any }[];
    const checking = accounts.find((a) => a.type === "checking")!.reconcile;
    const first = (await app.db.first<{ d: string }>("SELECT MIN(t.booking_date) AS d FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.type = 'checking'"))!.d;
    expect(checking).toMatchObject({ type: "CLBD", status: "proved", reason: null, provedFrom: first, provedTo: "2026-10-08", lastMatchedTo: "2026-10-08" });
    expect(checking.intervals).toHaveLength(1);
    expect(checking.intervals[0]).toMatchObject({ state: "matched", diffCents: 0 });
    expect(accounts.find((a) => a.type === "savings")!.reconcile).toMatchObject({ type: null, status: "unknown", reason: "only_available", intervals: [] });
    expect(accounts.find((a) => a.type === "credit_card")!.reconcile).toBeNull();
  });

  it("stops at a row that is one cent off: the stretch starts after it, and a second load makes the same answer", async () => {
    const app = await setupApp();
    await app.admin.call("POST", "/api/demo");
    const before = (await app.admin.call("GET", "/api/meta")).body.accounts.find((a: { type: string }) => a.type === "checking").reconcile;
    const mid = (await app.db.first<{ id: string; booking_date: string }>(
      "SELECT t.id, t.booking_date FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.type = 'checking' ORDER BY t.booking_date LIMIT 1 OFFSET 100",
    ))!;
    await app.db.run("UPDATE transactions SET amount_cents = amount_cents + 1 WHERE id = ?", [mid.id]);
    const after = (await app.admin.call("GET", "/api/meta")).body.accounts.find((a: { type: string }) => a.type === "checking").reconcile;
    expect(after.status).toBe("proved");
    expect(after.provedFrom! > mid.booking_date).toBe(true);
    expect(after.intervals.some((i: { state: string; diffCents: number }) => i.state === "differs" && i.diffCents === -1)).toBe(true);
    expect(after.lastMatchedTo).toBe("2026-10-08");

    await app.admin.call("POST", "/api/demo");
    expect((await app.admin.call("GET", "/api/meta")).body.accounts.find((a: { type: string }) => a.type === "checking").reconcile).toEqual(before);
  });
});
