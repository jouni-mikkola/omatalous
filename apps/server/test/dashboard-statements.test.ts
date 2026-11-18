/**
 * Yhteenveto asks for the dashboard and the shell for /api/meta on a page's load. Both read the view, the balances and
 * the member's inputs; the dashboard asked for the same pair again for each of its two lists of loan proposals, and
 * /meta worked out the month Yhteenveto opens on again on each request. These tests pin that a warm request makes a
 * bounded number of database statements, and that the opening month and the dashboard are what a fresh computation
 * gives. Made-up names and sums; the test clock is 9.10.2026.
 */
import { cashAhead, openingMonth, type RawTransaction } from "@banking/core";
import { describe, expect, it } from "vitest";
import { requestInputs } from "../src/services/analysis.ts";
import { reprocess } from "../src/services/enrich.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { setupApp, statementsOf } from "./helpers.ts";

const raw = (bookingDate: string, euros: number, counterparty: string, description: string): RawTransaction => ({
  externalId: null, bookingDate, valueDate: null, amountCents: Math.round(euros * 100), currency: "EUR", status: "booked",
  counterparty, counterpartyIban: null, description, reference: null, mcc: null,
});
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => `2026-${String(m).padStart(2, "0")}`);

async function household() {
  const t = await setupApp();
  const repo = t.s.finance(t.adminId);
  await repo.upsertAccount({ id: "chk", connectionId: null, provider: "csv", externalId: null, identity: null, name: "Käyttötili", iban: null, currency: "EUR", type: "checking" });
  await ingestTransactions(repo, "chk", MONTHS.flatMap((m) => [
    raw(`${m}-05`, -250, "ESIMERKKIRAHOITUS OY", "LAINAN LYHENNYS"),
    raw(`${m}-08`, -12.99, "MAX", "KORTTIOSTO"),
    raw(`${m}-15`, 3200, "ESIMERKKITYÖNANTAJA OY", "PALKKA"),
  ]), "csv");
  await reprocess(repo, t.s.settings);
  // a second member shares an account, so the household's view is not the own view
  const maija = await t.member("maija", "Maija");
  const maijaRepo = t.s.finance(maija.id);
  await maijaRepo.upsertAccount({ id: "maija-chk", connectionId: null, provider: "csv", externalId: null, identity: null, name: "Maijan tili", iban: null, currency: "EUR", type: "checking" });
  await ingestTransactions(maijaRepo, "maija-chk", MONTHS.map((m) => raw(`${m}-12`, -30, "TOINEN KAUPPA XYZ", "KORTTIOSTO")), "csv");
  await reprocess(maijaRepo, t.s.settings);
  expect((await maija.call("PUT", `/api/accounts/maija-chk/shares/${t.adminId}`)).status).toBe(200);
  return t;
}

/**
 * The most statements a warm request may make for this household. The dashboard made 39 (own view) and 56 (household)
 * before it read the view and the inputs once, then 29 and 44 (/meta 37); it makes 29 and 38 now, and /meta 33, since a
 * request reads the accounts in view and their uses once. A query added to a page raises it by that; a read of the
 * view again must not.
 */
const MOST = { meta: 33, own: 29, household: 38 };

describe("the dashboard and /meta read the view once", () => {
  it("the opening month is the one a fresh computation gives, on the first request and the next", async () => {
    const t = await household();
    const { ctx, accounts } = await t.s.analysis.get(t.s, t.adminId, "own");
    const { inputs } = await requestInputs(t.s, t.adminId, accounts);
    const fresh = openingMonth(cashAhead(ctx, [], inputs));
    expect((await t.admin.call("GET", "/api/meta")).body.opening).toBe(fresh);
    expect((await t.admin.call("GET", "/api/meta")).body.opening).toBe(fresh);
  });

  it("the dashboard of each view is the same on a second request", async () => {
    const t = await household();
    for (const scope of ["own", "household"]) {
      const first = await t.admin.call("GET", `/api/dashboard?scope=${scope}`);
      expect(first.status).toBe(200);
      expect((await t.admin.call("GET", `/api/dashboard?scope=${scope}`)).body).toEqual(first.body);
    }
  });

  it("a warm request makes a bounded number of statements", async () => {
    const t = await household();
    const get = (path: string) => async () => expect((await t.admin.call("GET", path)).status).toBe(200);
    for (const path of ["/api/meta", "/api/dashboard", "/api/dashboard?scope=household"]) await get(path)();
    const meta = await statementsOf(t.db, get("/api/meta"));
    const own = await statementsOf(t.db, get("/api/dashboard"));
    const household_ = await statementsOf(t.db, get("/api/dashboard?scope=household"));
    expect.soft(meta, "statements of a warm /meta").toBeLessThanOrEqual(MOST.meta);
    expect.soft(own, "statements of a warm dashboard of the own view").toBeLessThanOrEqual(MOST.own);
    expect.soft(household_, "statements of a warm dashboard of the household").toBeLessThanOrEqual(MOST.household);
  });
});
