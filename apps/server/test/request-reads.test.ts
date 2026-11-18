/**
 * A request that asks for the view more than once reads the accounts, their uses and the household once, and the next
 * request reads them again. These tests pin the memo of one request (`RequestReads`): it keeps one read per name and
 * key, a change ends it, and a view read through it makes fewer statements than one read alone and shows what a write
 * between two requests changed. Made-up names and sums; the test clock is 9.10.2026.
 */
import type { RawTransaction } from "@banking/core";
import { describe, expect, it } from "vitest";
import { reprocess } from "../src/services/enrich.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { RequestReads } from "../src/services/request-reads.ts";
import { setupApp, statementsOf } from "./helpers.ts";

const raw = (bookingDate: string, euros: number, counterparty: string, description: string): RawTransaction => ({
  externalId: null, bookingDate, valueDate: null, amountCents: Math.round(euros * 100), currency: "EUR", status: "booked",
  counterparty, counterpartyIban: null, description, reference: null, mcc: null,
});

async function household() {
  const t = await setupApp();
  const repo = t.s.finance(t.adminId);
  await repo.upsertAccount({ id: "chk", connectionId: null, provider: "csv", externalId: null, identity: null, name: "Käyttötili", iban: null, currency: "EUR", type: "checking" });
  await ingestTransactions(repo, "chk", [raw("2026-09-15", 3200, "ESIMERKKITYÖNANTAJA OY", "PALKKA"), raw("2026-09-08", -12.99, "MAX", "KORTTIOSTO")], "csv");
  await reprocess(repo, t.s.settings);
  const maija = await t.member("maija", "Maija");
  const maijaRepo = t.s.finance(maija.id);
  await maijaRepo.upsertAccount({ id: "maija-chk", connectionId: null, provider: "csv", externalId: null, identity: null, name: "Maijan tili", iban: null, currency: "EUR", type: "checking" });
  await ingestTransactions(maijaRepo, "maija-chk", [raw("2026-09-12", -30, "TOINEN KAUPPA XYZ", "KORTTIOSTO")], "csv");
  await reprocess(maijaRepo, t.s.settings);
  expect((await maija.call("PUT", `/api/accounts/maija-chk/shares/${t.adminId}`)).status).toBe(200);
  return { ...t, maija };
}

describe("RequestReads", () => {
  it("reads once for a name and a key, and again for another", async () => {
    const reads = new RequestReads();
    let n = 0;
    const read = async () => ++n;
    expect(await Promise.all([reads.once("a", "x", read), reads.once("a", "x", read), reads.once("a", "y", read), reads.once("b", "x", read)])).toEqual([1, 1, 2, 3]);
    expect(await reads.once("a", "x", read)).toBe(1);
  });

  it("reads again after a change, and keeps no read that failed", async () => {
    const reads = new RequestReads();
    let n = 0;
    expect(await reads.once("a", "x", async () => ++n)).toBe(1);
    reads.changed();
    expect(await reads.once("a", "x", async () => ++n)).toBe(2);
    await expect(reads.once("b", "x", async () => { throw new Error("down"); })).rejects.toThrow("down");
    expect(await reads.once("b", "x", async () => 7)).toBe(7);
  });

  it("does not keep a read that a change overtook", async () => {
    const reads = new RequestReads();
    let release!: (n: number) => void;
    const slow = reads.once("a", "x", () => new Promise<number>((resolve) => (release = resolve)));
    reads.changed();
    release(1);
    expect(await slow).toBe(1);
    expect(await reads.once("a", "x", async () => 2)).toBe(2);
  });
});

describe("a view read through the memo of a request", () => {
  it("makes fewer statements the second time, in each view", async () => {
    const t = await household();
    for (const view of ["own", "household"] as const) {
      await t.s.analysis.get(t.s, t.adminId, view);
      const alone = await statementsOf(t.db, () => t.s.analysis.get(t.s, t.adminId, view));
      const reads = new RequestReads();
      await statementsOf(t.db, () => t.s.analysis.get(t.s, t.adminId, view, undefined, reads));
      const again = await statementsOf(t.db, () => t.s.analysis.get(t.s, t.adminId, view, undefined, reads));
      expect(again, `statements of the ${view} view read again`).toBeLessThan(alone);
    }
  });

  it("gives the same view as a read without it", async () => {
    const t = await household();
    const reads = new RequestReads();
    const alone = await t.s.analysis.get(t.s, t.adminId, "household");
    const through = await t.s.analysis.get(t.s, t.adminId, "household", undefined, reads);
    expect(through).toBe(alone);
    expect(through.accounts.map((a) => a.id).sort()).toEqual(["chk", "maija-chk"]);
  });

  it("shows a share that ended to the next request, not to the one that read it before", async () => {
    const t = await household();
    const reads = new RequestReads();
    const ids = async (r?: RequestReads) => (await t.s.analysis.get(t.s, t.adminId, "household", undefined, r)).accounts.map((a) => a.id).sort();
    expect(await ids(reads)).toEqual(["chk", "maija-chk"]);
    expect((await t.maija.call("DELETE", `/api/accounts/maija-chk/shares/${t.adminId}`)).status).toBe(200);
    expect(await ids(new RequestReads())).toEqual(["chk"]);
    expect(await ids()).toEqual(["chk"]);
  });
});
