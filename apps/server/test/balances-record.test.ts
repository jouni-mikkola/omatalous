/**
 * What each fetch records about balances and history: the balances the bank sent, one row per real account, day and
 * type; how far back the app asked; and the calls made. Nothing reads them yet but these tests. Made-up data.
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { syncUser } from "../src/connectors/sync.ts";
import { accountKey } from "../src/db/household-repo.ts";
import type { NewAccount } from "../src/db/finance-repo.ts";
import { runUpgradeTasks } from "../src/services/upgrade.ts";
import { setupApp, waitFor } from "./helpers.ts";
import { mockBank } from "./mock-bank.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const reading = (amount: string, type: string, referenceDate?: string, currency = "EUR") => ({
  balance_amount: { currency, amount },
  balance_type: type,
  ...(referenceDate ? { reference_date: referenceDate } : {}),
});

/** A linked bank whose checking account answers the balances given; the first fetch (the link) already records them. */
async function connected(balances?: unknown[]) {
  const bank = mockBank();
  if (balances) bank.answers["GET /accounts/u-chk/balances"] = { status: 200, body: { balances } };
  const app = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
  await app.admin.call("POST", "/api/connections/start", {});
  await app.admin.call("POST", "/api/connections/complete", { url: `https://x.example/cb?code=abc&state=${bank.state}` });
  await waitFor(async () => (await app.admin.call("GET", "/api/sync/runs")).body.runs.every((r: { status: string }) => r.status !== "running"));
  const chk = (await app.s.finance(app.adminId).listAccounts()).find((a) => a.externalId === "u-chk")!;
  return { bank, ...app, chk, key: accountKey(chk) };
}

type Db = Awaited<ReturnType<typeof setupApp>>["db"];
const balancesOf = (db: Db, key: string) =>
  db.all<{ day: string; type: string; reference_date: string | null; cents: number; source: string; fetched_at: string }>(
    "SELECT day, type, reference_date, cents, source, fetched_at FROM account_balances WHERE account_key = ? ORDER BY day, type",
    [key],
  );

const account = (id: string, identity: string | null, over: Partial<NewAccount> = {}): NewAccount => ({
  id,
  connectionId: null,
  provider: "enablebanking",
  externalId: `ext-${id}`,
  identity,
  name: "Yhteinen tili",
  iban: null,
  currency: "EUR",
  type: "checking",
  ...over,
});

describe("balances recorded by a fetch", () => {
  it("records every balance with its type and reference day, and still shows the one it picked", async () => {
    const { db, admin, key } = await connected([
      reading("1300.00", "ITAV"),
      reading("1250.00", "CLBD", "2026-10-08"),
      reading("1100.00", "pending balance"),
      reading("1000.00", "PRCD", "2026-10-07"),
    ]);
    expect(await balancesOf(db, key)).toEqual([
      { day: "2026-10-09", type: "CLBD", reference_date: "2026-10-08", cents: 125_000, source: "bank", fetched_at: "2026-10-09T10:00:00.000Z" },
      { day: "2026-10-09", type: "ITAV", reference_date: null, cents: 130_000, source: "bank", fetched_at: "2026-10-09T10:00:00.000Z" },
      { day: "2026-10-09", type: "OTHR", reference_date: null, cents: 110_000, source: "bank", fetched_at: "2026-10-09T10:00:00.000Z" },
      { day: "2026-10-09", type: "PRCD", reference_date: "2026-10-07", cents: 100_000, source: "bank", fetched_at: "2026-10-09T10:00:00.000Z" },
    ]);
    const shown = (await admin.call("GET", "/api/meta")).body.accounts.find((a: { type: string }) => a.type === "checking");
    expect(shown.balanceCents).toBe(125_000);
  });

  it("replaces a row of the same account, day and type when it is fetched again that day: the last fetch stands", async () => {
    const { db, bank, s, adminId, key } = await connected([reading("1250.00", "CLBD", "2026-10-08")]);
    bank.answers["GET /accounts/u-chk/balances"] = { status: 200, body: { balances: [reading("1180.50", "CLBD", "2026-10-09")] } };
    await syncUser(s, adminId, "manual");
    expect(await balancesOf(db, key)).toMatchObject([{ day: "2026-10-09", type: "CLBD", reference_date: "2026-10-09", cents: 118_050, source: "bank" }]);
  });

  it("never records an amount in another currency, and records the euro ones beside it", async () => {
    const { db, key } = await connected([reading("540.00", "CLBD", "2026-10-08", "USD"), reading("12.00", "ITBD", "2026-10-08"), reading("1.00", "OPBD", undefined, "")]);
    expect(await balancesOf(db, key)).toMatchObject([{ type: "ITBD", cents: 1_200 }]);
    const none = await connected([reading("540.00", "CLBD", "2026-10-08", "USD")]);
    expect(await balancesOf(none.db, none.key)).toEqual([]);
  });

  it("signs a loan's balance as the account stores it", async () => {
    const { db, s, adminId, chk, key } = await connected([reading("8000.00", "CLBD", "2026-10-08")]);
    await s.finance(adminId).updateAccount(chk.id, { type: "loan" });
    await syncUser(s, adminId, "manual");
    expect(await balancesOf(db, key)).toMatchObject([{ type: "CLBD", cents: -800_000 }]);
  });
});

describe("a joint account and its key", () => {
  it("is one row per day and type when both members fetch it, the later fetch winning and an older one never", async () => {
    const { db, s, adminId, member } = await setupApp();
    const maija = await member("maija");
    await s.finance(adminId).upsertAccount(account("a-matti", "idn-joint"));
    await s.finance(maija.id).upsertAccount(account("a-maija", "idn-joint"));
    const key = accountKey({ id: "a-matti", identity: "idn-joint" });
    expect(key).toBe(accountKey({ id: "a-maija", identity: "idn-joint" }));
    await s.finance(adminId).recordBalances(key, "2026-10-20", "2026-10-20T08:00:00.000Z", [{ cents: 125_000, type: "CLBD", referenceDay: "2026-10-19" }]);
    await s.finance(maija.id).recordBalances(key, "2026-10-20", "2026-10-20T09:00:00.000Z", [
      { cents: 125_000, type: "CLBD", referenceDay: "2026-10-19" },
      { cents: 130_000, type: "ITAV", referenceDay: null },
    ]);
    expect(await balancesOf(db, key)).toMatchObject([
      { type: "CLBD", fetched_at: "2026-10-20T09:00:00.000Z" },
      { type: "ITAV", cents: 130_000 },
    ]);
    // a fetch that finishes late, with a figure that is older, does not take the row back
    await s.finance(adminId).recordBalances(key, "2026-10-20", "2026-10-20T08:30:00.000Z", [{ cents: 1, type: "CLBD", referenceDay: null }]);
    expect(await balancesOf(db, key)).toMatchObject([{ type: "CLBD", cents: 125_000 }, { type: "ITAV" }]);
  });

  it("keeps its balances always, and the other rows while one member holds a copy, losing those with the last copy", async () => {
    const { db, s, adminId, member } = await setupApp();
    const maija = await member("maija");
    await s.finance(adminId).upsertAccount(account("a-matti", "idn-joint"));
    await s.finance(maija.id).upsertAccount(account("a-maija", "idn-joint"));
    await s.finance(adminId).recordBalances("idn-joint", "2026-10-20", "2026-10-20T08:00:00.000Z", [{ cents: 125_000, type: "CLBD", referenceDay: null }]);
    await s.finance(adminId).recordFetch("idn-joint", new Date("2026-10-20T08:00:00Z"), "schedule");
    await s.finance(adminId).deleteAccount("a-matti");
    expect(await balancesOf(db, "idn-joint")).toHaveLength(1);
    await s.finance(maija.id).deleteAccount("a-maija");
    // a balance cannot be fetched again, and the key may be linked again: it stays
    expect(await balancesOf(db, "idn-joint")).toHaveLength(1);
    expect(await db.all("SELECT 1 FROM account_fetch")).toEqual([]);
  });

  it("keeps its rows when the bank renews the consent and the account's external id changes", async () => {
    const { db, s, adminId } = await setupApp();
    await s.finance(adminId).upsertAccount(account("a-matti", "idn-joint"));
    await s.finance(adminId).recordBalances("idn-joint", "2026-10-20", "2026-10-20T08:00:00.000Z", [{ cents: 125_000, type: "CLBD", referenceDay: null }]);
    await s.finance(adminId).upsertAccount(account("a-matti", "idn-joint", { externalId: "renewed" }));
    expect(await balancesOf(db, "idn-joint")).toHaveLength(1);
  });

  it("does not delete the rows of a key when one member of it is removed", async () => {
    const { db, s, adminId, member } = await setupApp();
    const maija = await member("maija");
    await s.finance(adminId).upsertAccount(account("a-matti", "idn-joint"));
    await s.finance(maija.id).upsertAccount(account("a-maija", "idn-joint"));
    await s.finance(adminId).recordBalances("idn-joint", "2026-10-20", "2026-10-20T08:00:00.000Z", [{ cents: 125_000, type: "CLBD", referenceDay: null }]);
    await s.finance(maija.id).recordFetch("idn-joint", new Date("2026-10-20T09:00:00Z"), "manual");
    await s.household.removeMember(maija.id);
    expect(await balancesOf(db, "idn-joint")).toHaveLength(1);
    // her call stays, without her name
    expect(await db.all("SELECT user_id FROM account_fetch")).toEqual([{ user_id: null }]);
  });
});

describe("an account without an identity", () => {
  it("is keyed by its own id, and a merge into another account leaves its balances", async () => {
    const { db, s, adminId } = await setupApp();
    const repo = s.finance(adminId);
    await repo.upsertAccount(account("csv-1", null, { provider: "csv", externalId: null }));
    await repo.upsertAccount(account("a-bank", "idn-1"));
    expect(accountKey({ id: "csv-1", identity: null })).toBe("csv-1");
    await repo.recordBalances("csv-1", "2026-10-20", "2026-10-20T08:00:00.000Z", [{ cents: 5_000, type: "CLBD", referenceDay: null }]);
    await repo.mergeAccountInto("csv-1", "a-bank", new Map());
    expect(await balancesOf(db, "csv-1")).toHaveLength(1);
  });
});

describe("the seed from today's stored balance", () => {
  const seeded = async () => {
    const { db, s, adminId } = await setupApp();
    const repo = s.finance(adminId);
    await repo.upsertAccount(account("eur", "idn-eur"));
    await repo.setAccountBalance("eur", 90_000, "2026-10-15T12:00:00.000Z");
    await repo.upsertAccount(account("usd", "idn-usd", { currency: "USD" }));
    await repo.setAccountBalance("usd", 54_000, "2026-10-15T12:00:00.000Z");
    await repo.upsertAccount(account("none", "idn-none"));
    return { db, s, adminId, repo };
  };

  it("writes one OTHR row with no reference day for a euro account, none for another currency or an account with no balance", async () => {
    const { db, s } = await seeded();
    expect(await runUpgradeTasks(s, "0.46.0+seed")).toMatchObject({ steps: { balanceSeed: 1 } });
    expect(await balancesOf(db, "idn-eur")).toEqual([
      { day: "2026-10-15", type: "OTHR", reference_date: null, cents: 90_000, source: "seed", fetched_at: "2026-10-15T12:00:00.000Z" },
    ]);
    expect(await balancesOf(db, "idn-usd")).toEqual([]);
    expect(await balancesOf(db, "idn-none")).toEqual([]);
  });

  it("is left alone by a build below its floor, and runs once for a build", async () => {
    const { db, s } = await seeded();
    expect((await runUpgradeTasks(s, "0.45.9+a"))?.skipped).toContain("balanceSeed");
    expect(await db.all("SELECT 1 FROM account_balances")).toEqual([]);
    await runUpgradeTasks(s, "0.46.0+b");
    expect(await runUpgradeTasks(s, "0.46.0+b")).toBeNull();
    expect(await db.all("SELECT 1 FROM account_balances")).toHaveLength(1);
  });

  it("never replaces a row the bank sent, and is replaced by the bank's row of the same day and type", async () => {
    const { db, s, repo } = await seeded();
    await repo.recordBalances("idn-eur", "2026-10-15", "2026-10-15T07:00:00.000Z", [{ cents: 91_000, type: "OTHR", referenceDay: null }]);
    await runUpgradeTasks(s, "0.46.0+c");
    expect(await balancesOf(db, "idn-eur")).toMatchObject([{ cents: 91_000, source: "bank" }]);
    await db.run("DELETE FROM account_balances");
    await repo.seedBalancesFromAccounts();
    await repo.recordBalances("idn-eur", "2026-10-15", "2026-10-15T13:00:00.000Z", [{ cents: 92_000, type: "OTHR", referenceDay: null }]);
    expect(await balancesOf(db, "idn-eur")).toMatchObject([{ cents: 92_000, source: "bank" }]);
  });
});

describe("how far back the app asked", () => {
  const historyOf = (db: Db) => db.all<{ account_id: string; asked_from: string; first_row_day: string | null; source: string }>("SELECT account_id, asked_from, first_row_day, source FROM account_history ORDER BY account_id");

  it("is one row per accounts row, set at the first fetch, which asks for the longest history, from the first day asked and the oldest row stored", async () => {
    const { db, chk } = await connected();
    const rows = await historyOf(db);
    expect(rows).toHaveLength(2);
    const id = chk.id;
    const first = (await db.first<{ d: string }>("SELECT MIN(booking_date) AS d FROM transactions WHERE account_id = ? AND status = 'booked'", [id]))!.d;
    const mine = rows.find((r) => r.account_id === id)!;
    expect(mine).toMatchObject({ source: "longest", first_row_day: first });
    expect(mine.asked_from <= first).toBe(true);
  });

  it("moves only earlier: a later window changes nothing, a longer one moves it", async () => {
    const { db, s, adminId, member } = await setupApp();
    const maija = await member("maija");
    await s.finance(adminId).upsertAccount(account("a-matti", "idn-joint"));
    await s.finance(maija.id).upsertAccount(account("a-maija", "idn-joint"));
    await s.finance(adminId).recordHistory("a-matti", "2026-08-01", "default", "2026-10-09T10:00:00.000Z");
    await s.finance(adminId).recordHistory("a-matti", "2026-10-01", "default", "2026-10-10T10:00:00.000Z");
    expect(await historyOf(db)).toEqual([{ account_id: "a-matti", asked_from: "2026-08-01", first_row_day: null, source: "default" }]);
    await s.finance(adminId).recordHistory("a-matti", "2026-05-01", "longest", "2026-10-11T10:00:00.000Z");
    // the other member's copy starts later and has a row of its own
    await s.finance(maija.id).recordHistory("a-maija", "2026-09-20", "default", "2026-10-11T11:00:00.000Z");
    expect(await historyOf(db)).toEqual([
      { account_id: "a-maija", asked_from: "2026-09-20", first_row_day: null, source: "default" },
      { account_id: "a-matti", asked_from: "2026-05-01", first_row_day: null, source: "longest" },
    ]);
  });

  it("asks from the oldest stored booked row when a file import holds an older one, and a merge keeps the earlier of two", async () => {
    const { db, s, adminId } = await setupApp();
    const repo = s.finance(adminId);
    await repo.upsertAccount(account("csv-1", null, { provider: "csv", externalId: null }));
    await repo.upsertAccount(account("a-bank", "idn-1"));
    await db.run(
      "INSERT INTO transactions (id, user_id, account_id, booking_date, amount_cents, currency, status, merchant, category, category_source, source, imported_at) VALUES ('t1', ?, 'a-bank', '2026-03-02', -500, 'EUR', 'booked', 'KAHVILA', 'groceries', 'default', 'csv', '2026-10-01T00:00:00.000Z')",
      [adminId],
    );
    await repo.recordHistory("a-bank", "2026-09-01", "default", "2026-10-09T10:00:00.000Z");
    expect(await historyOf(db)).toEqual([{ account_id: "a-bank", asked_from: "2026-03-02", first_row_day: "2026-03-02", source: "default" }]);
    await repo.recordHistory("csv-1", "2026-01-15", "csv", "2026-10-09T10:00:00.000Z");
    await repo.mergeAccountInto("csv-1", "a-bank", new Map());
    expect(await historyOf(db)).toEqual([{ account_id: "a-bank", asked_from: "2026-01-15", first_row_day: "2026-03-02", source: "default" }]);
  });
});

describe("the calls made to the bank", () => {
  it("notes each call with its trigger and the member, one per account, and drops notes older than eight days", async () => {
    const { db, s, adminId, key } = await connected();
        expect((await db.all<{ trigger: string; user_id: string }>("SELECT trigger, user_id FROM account_fetch WHERE account_key = ?", [key]))).toEqual([{ trigger: "connect-bare", user_id: adminId }]);
    await s.finance(adminId).recordFetch(key, new Date("2026-09-20T10:00:00Z"), "schedule");
    expect(await db.all("SELECT 1 FROM account_fetch WHERE at < '2026-10-01'")).toHaveLength(1);
    await syncUser(s, adminId, "open-bare");
    expect(await db.all("SELECT 1 FROM account_fetch WHERE at < '2026-10-01'")).toEqual([]);
    expect((await db.all<{ trigger: string }>("SELECT trigger FROM account_fetch WHERE account_key = ? ORDER BY id", [key])).map((r) => r.trigger)).toEqual(["connect-bare", "open-bare"]);
  });
});
