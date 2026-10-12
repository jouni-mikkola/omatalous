/**
 * What a killed process leaves behind and how the next start (or the hourly tick) repairs it: unprocessed
 * imports, upgrade and sync locks, fetches left as "running".
 */
import type { RawTransaction } from "@banking/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reprocess } from "../src/services/enrich.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { finishPendingReprocess, recoverAfterCrash } from "../src/services/recovery.ts";
import { hourlyTick } from "../src/services/schedule.ts";
import { runUpgradeTasks } from "../src/services/upgrade.ts";
import { setupApp } from "./helpers.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const raw = (bookingDate: string, euros: number, counterparty: string): RawTransaction => ({
  externalId: null, bookingDate, valueDate: null, amountCents: Math.round(euros * 100), currency: "EUR", status: "booked",
  counterparty, counterpartyIban: null, description: null, reference: null, mcc: null,
});

async function withUnprocessedImport() {
  const t = await setupApp();
  const repo = t.s.finance(t.adminId);
  await repo.upsertAccount({ id: "chk", connectionId: null, provider: "csv", externalId: null, identity: null, name: "Tili", iban: null, currency: "EUR", type: "checking" });
  const before = await t.s.settings.dataVersionOf([t.adminId]);
  // the process is killed here: rows are stored, reprocess never runs
  await ingestTransactions(repo, "chk", [raw("2026-10-01", -42, "K-MARKET HERTTONIEMI"), raw("2026-10-02", 2500, "TYÖNANTAJA OY")], "csv");
  return { ...t, repo, before };
}

describe("an import whose reprocess did not finish", () => {
  it("leaves a mark in the same batch as the rows, and a new data version", async () => {
    const t = await withUnprocessedImport();
    expect(await t.repo.unprocessedMark()).not.toBeNull();
    expect(await t.s.settings.keysWithPrefix("needs_reprocess:")).toEqual([`needs_reprocess:${t.adminId}`]);
    expect(await t.s.settings.dataVersionOf([t.adminId])).not.toBe(t.before);
    const rows = await t.repo.transactionsOfAccount("chk");
    expect(rows.map((r) => r.categorySource)).toEqual(["default", "default"]);
  });

  it("is finished by finishPendingReprocess, which clears the mark", async () => {
    const t = await withUnprocessedImport();
    expect(await finishPendingReprocess(t.s)).toBe(1);
    expect(await t.repo.unprocessedMark()).toBeNull();
    const grocery = (await t.repo.transactionsOfAccount("chk")).find((r) => r.merchant.toLowerCase().includes("k-market"))!;
    expect(grocery.category).not.toBe("other");
    expect(await finishPendingReprocess(t.s)).toBe(0);
  });

  it("is finished by the hourly tick", async () => {
    const t = await withUnprocessedImport();
    await hourlyTick(t.s);
    expect(await t.repo.unprocessedMark()).toBeNull();
  });

  it("keeps a mark that an import set while reprocess was running", async () => {
    const t = await withUnprocessedImport();
    const seen = await t.repo.unprocessedMark();
    await t.repo.batch(t.repo.unprocessedStatements(new Date().toISOString())); // a second import lands
    await t.repo.clearUnprocessedMark(seen);
    expect(await t.repo.unprocessedMark()).not.toBeNull();
    await reprocess(t.repo, t.s.settings);
    expect(await t.repo.unprocessedMark()).toBeNull();
  });

  it("drops the mark of a user that no longer exists and survives a failing reprocess", async () => {
    const t = await withUnprocessedImport();
    await t.s.settings.set("needs_reprocess:gone", "x");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(t.repo, "allTransactions").mockRejectedValue(new Error("busy"));
    vi.spyOn(t.s, "finance").mockReturnValue(t.repo);
    expect(await finishPendingReprocess(t.s)).toBe(0);
    expect(errors).toHaveBeenCalled();
    expect(await t.s.settings.get("needs_reprocess:gone")).toBeNull();
    expect(await t.repo.unprocessedMark()).not.toBeNull(); // still waiting for the next tick
  });
});

describe("locks and runs a killed process left", () => {
  it("clears the upgrade lock and sync locks at start, so the upgrade runs", async () => {
    const t = await setupApp();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await t.s.settings.tryLock("upgrade_lock", 600_000);
    await t.s.settings.tryLock(`sync_lock:${t.adminId}`, 600_000);
    await t.s.settings.set("backup_day", "2026-10-09"); // not a lock, stays
    expect(await runUpgradeTasks(t.s, "9.9.9+x")).toBeNull();
    expect(log.mock.calls.flat().join(" ")).toMatch(/upgrade tasks for 9\.9\.9\+x skipped: another run holds upgrade_lock/);

    await recoverAfterCrash(t.s, new Date(Date.now() + 1000));
    expect(await t.s.settings.get("upgrade_lock")).toBeNull();
    expect(await t.s.settings.get(`sync_lock:${t.adminId}`)).toBeNull();
    expect(await t.s.settings.get("backup_day")).toBe("2026-10-09");
    expect(await runUpgradeTasks(t.s, "9.9.9+x")).toMatchObject({ users: 1 });
    expect(await t.s.settings.get("app_build")).toBe("9.9.9+x");
  });

  it("does not clear a lock taken after the process started", async () => {
    const t = await setupApp();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const started = new Date(Date.now() - 60_000);
    await t.s.settings.tryLock("upgrade_lock", 600_000);
    await recoverAfterCrash(t.s, started);
    expect(await t.s.settings.get("upgrade_lock")).not.toBeNull();
  });

  it("marks a fetch left as running as failed", async () => {
    const t = await setupApp();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const repo = t.s.finance(t.adminId);
    const stuck = await repo.startSyncRun("schedule");
    const done = await repo.startSyncRun("manual");
    await repo.finishSyncRun(done, { status: "ok", fetched: 1, inserted: 1, message: null });
    await recoverAfterCrash(t.s, new Date(Date.now() + 1000));
    const runs = await repo.listSyncRuns();
    expect(runs.find((r) => r.id === stuck)).toMatchObject({ status: "failed", message: expect.stringContaining("keskeytyi") });
    expect(runs.find((r) => r.id === stuck)!.finishedAt).not.toBeNull();
    expect(runs.find((r) => r.id === done)!.status).toBe("ok");
  });

  it("prunes old fetch runs in the hourly tick", async () => {
    const t = await setupApp();
    const repo = t.s.finance(t.adminId);
    for (let i = 0; i < 230; i++) await repo.finishSyncRun(await repo.startSyncRun("schedule"), { status: "ok", fetched: 0, inserted: 0, message: null });
    await hourlyTick(t.s);
    expect((await repo.listSyncRuns(500)).length).toBe(200);
  });
});

describe("upgrade tasks that were cut short", () => {
  it("resume with the users not yet done and run again from the hourly tick while the build differs", async () => {
    const t = await setupApp({}, undefined, { build: { version: "1.0.0", id: "1.0.0+new" } });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const eero = await t.member("eero");
    // a run that finished the first user and died
    await t.s.settings.set(`app_build:${t.adminId}`, "1.0.0+new");
    const seen: string[] = [];
    const real = t.s.finance;
    vi.spyOn(t.s, "finance").mockImplementation((id) => (seen.push(id), real(id)));
    await hourlyTick(t.s);
    expect(seen).toContain(eero.id);
    expect(await t.s.settings.get("app_build")).toBe("1.0.0+new");
    expect(await t.s.settings.get(`app_build:${eero.id}`)).toBe("1.0.0+new");
  });
});
