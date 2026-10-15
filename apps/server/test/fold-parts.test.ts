/**
 * Folding a file account into the bank account with the same IBAN renames the rows (connectors/fold-accounts.ts). The
 * stored parts of a row (`tx_part`, keyed by the row id) have to follow the rename and the move, or the split of a
 * joint account's rows is lost or the fold refuses.
 */
import { fold } from "@banking/core";
import { describe, expect, it } from "vitest";
import { foldCsvAccounts } from "../src/connectors/fold-accounts.ts";
import type { PartRow } from "../src/db/household-repo.ts";
import { stableId } from "../src/platform/ids.ts";
import { setupApp } from "./helpers.ts";

const IBAN = "FI2112345600000785";
const split = (a: number, b: number): PartRow[] => [
  { owner: "u:aino", kind: "own", grp: "", cents: a, passed: false },
  { owner: "u:ville", kind: "own", grp: "", cents: b, passed: true },
];

function row(id: string, accountId: string, date: string, cents: number, source: string, status = "booked", over: Partial<{ category: string; categorySource: "user" | "default" | "rule"; isTransfer: boolean }> = {}) {
  return {
    id, accountId, bookingDate: date, valueDate: date, amountCents: cents, currency: "EUR", status: status as "booked" | "pending",
    counterparty: "ESIMERKKI OY", counterpartyIban: null, description: "Lasku", reference: null, mcc: null, bankTxnCode: null,
    merchant: "ESIMERKKI OY", category: "other", categorySource: "default" as const, isTransfer: false, source, raw: null, ...over,
  };
}

async function world() {
  const app = await setupApp();
  const repo = app.s.finance(app.adminId);
  const both = { connectionId: null, iban: IBAN, currency: "EUR", type: "checking" } as const;
  await repo.upsertAccount({ ...both, id: "a-file", provider: "csv", externalId: null, identity: null, name: "Tili tiedostosta" });
  await repo.upsertAccount({ ...both, id: "a-bank", provider: "enablebanking", externalId: "x", identity: "x", name: "Tili pankista" });
  const put = async (rows: ReturnType<typeof row>[], parts: Record<string, PartRow[]>) => {
    await repo.batch(repo.upsertStatements(rows, "2026-10-09T00:00:00Z"));
    await app.s.household.writeParts(new Map(Object.entries(parts)), new Map(), { key: "x", signature: "s", builtAt: "2026-10-09T00:00:00Z", lots: "[]" });
  };
  /** Each part of the rows of an account as text, by booking date. */
  const parts = async (accountId: string) =>
    (await app.db.all<{ line: string }>(
      `SELECT t.booking_date || '|' || p.owner || '|' || p.cents || '|' || p.passed AS line FROM tx_part p JOIN transactions t ON t.id = p.tx_id WHERE t.account_id = ? ORDER BY t.booking_date, p.owner`,
      [accountId],
    )).map((r) => r.line);
  const partsOfRow = async (txId: string) => (await app.db.all<{ line: string }>("SELECT owner || '|' || cents || '|' || passed AS line FROM tx_part WHERE tx_id = ? ORDER BY owner", [txId])).map((r) => r.line);
  const orphans = async () => (await app.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM tx_part WHERE tx_id NOT IN (SELECT id FROM transactions)"))!.n;
  return { ...app, repo, put, parts, orphans, partsOfRow };
}

describe("folding a file account into the bank account", () => {
  it("keeps the parts of a row that is renamed and moved", async () => {
    const w = await world();
    await w.put([row("f1", "a-file", "2026-09-01", -10_001, "csv"), row("f2", "a-file", "2026-09-02", -5_000, "csv")], { f1: split(-5_001, -5_000), f2: split(-2_500, -2_500) });

    expect(await foldCsvAccounts(w.repo)).toBe(1);

    expect(await w.parts("a-bank")).toEqual(["2026-09-01|u:aino|-5001|0", "2026-09-01|u:ville|-5000|1", "2026-09-02|u:aino|-2500|0", "2026-09-02|u:ville|-2500|1"]);
    expect(await w.orphans()).toBe(0);
  });

  it("keeps the parts of a row whose id stays (a pending row moves only its account)", async () => {
    const w = await world();
    await w.put([row("f1", "a-file", "2026-09-01", -4_000, "csv", "pending")], { f1: split(-3_000, -1_000) });

    expect(await foldCsvAccounts(w.repo)).toBe(1);

    expect(await w.parts("a-bank")).toEqual(["2026-09-01|u:aino|-3000|0", "2026-09-01|u:ville|-1000|1"]);
  });

  it("leaves the bank's own row and its parts when the file row is a duplicate of it", async () => {
    const w = await world();
    await w.put([row("f1", "a-file", "2026-09-01", -10_001, "csv")], { f1: split(-5_001, -5_000) });
    // the bank account now holds the row under the id a fold gives it; a second file row folds to that id
    const first = await foldCsvAccounts(w.repo);
    expect(first).toBe(1);
    const moved = (await w.repo.transactionsOfAccount("a-bank"))[0]!;
    await w.repo.upsertAccount({ connectionId: null, iban: IBAN, currency: "EUR", type: "checking", id: "a-file", provider: "csv", externalId: null, identity: null, name: "Tili tiedostosta" });
    await w.put([row("f9", "a-file", "2026-09-01", -10_001, "csv")], { f9: split(-1, -10_000) });
    expect(moved.id).not.toBe("f9");

    expect(await foldCsvAccounts(w.repo)).toBe(1);

    const kept = await w.partsOfRow(moved.id);
    expect(kept).toEqual(["u:aino|-5001|0", "u:ville|-5000|1"]);
    // one row, one sum: the file copy is dropped, not moved beside it
    const left = await w.db.all<{ id: string; amount_cents: number }>("SELECT id, amount_cents FROM transactions WHERE account_id = 'a-bank'");
    expect(left).toEqual([{ id: moved.id, amount_cents: -10_001 }]);
    expect(await w.repo.getAccount("a-file")).toBeNull();
    expect(await w.orphans()).toBe(0);
  });

  /** The id the fold gives a file row of this day and sum, which a bank sync that ran before the fold has stored it under. */
  const foldedId = (date: string, cents: number) => stableId(`a-bank|booked|c|${date}|${cents}|${fold("ESIMERKKI OY")}|${fold("Lasku")}|0`);
  const bankRow = (date: string, cents: number, over: Partial<ReturnType<typeof row>> = {}) => ({ ...row(foldedId(date, cents), "a-bank", date, cents, "enablebanking"), ...over });
  const stateOf = async (w: Awaited<ReturnType<typeof world>>, id: string) => w.db.first<{ category: string; category_source: string; is_transfer: number }>("SELECT category, category_source, is_transfer FROM transactions WHERE id = ?", [id]);

  it("gives the split of the dropped file copy to the bank row that has none", async () => {
    const w = await world();
    const id = foldedId("2026-09-01", -10_001);
    await w.put([bankRow("2026-09-01", -10_001)], {});
    await w.put([row("f1", "a-file", "2026-09-01", -10_001, "csv")], { f1: split(-5_001, -5_000) });

    expect(await foldCsvAccounts(w.repo)).toBe(1);

    expect(await w.partsOfRow(id)).toEqual(["u:aino|-5001|0", "u:ville|-5000|1"]);
    expect(await w.db.all("SELECT id FROM transactions")).toEqual([{ id }]);
    expect(await w.orphans()).toBe(0);
  });

  it("keeps the split of the bank row when both have one", async () => {
    const w = await world();
    const id = foldedId("2026-09-01", -10_001);
    await w.put([bankRow("2026-09-01", -10_001)], { [id]: split(-10_001, 0) });
    await w.put([row("f1", "a-file", "2026-09-01", -10_001, "csv")], { f1: split(-5_001, -5_000) });

    await foldCsvAccounts(w.repo);

    expect(await w.partsOfRow(id)).toEqual(["u:aino|-10001|0", "u:ville|0|1"]);
  });

  it("gives the category a user set on the file copy to a bank row that has an automatic one", async () => {
    const w = await world();
    const id = foldedId("2026-09-01", -10_001);
    await w.put([bankRow("2026-09-01", -10_001, { category: "other", categorySource: "default" })], {});
    await w.put([row("f1", "a-file", "2026-09-01", -10_001, "csv", "booked", { category: "groceries", categorySource: "user", isTransfer: true })], {});

    await foldCsvAccounts(w.repo);

    expect(await stateOf(w, id)).toEqual({ category: "groceries", category_source: "user", is_transfer: 1 });
  });

  it("keeps the category a user set on the bank row, and an automatic category of the copy moves nothing", async () => {
    const w = await world();
    const a = foldedId("2026-09-01", -10_001);
    const b = foldedId("2026-09-02", -2_000);
    await w.put([bankRow("2026-09-01", -10_001, { category: "travel", categorySource: "user" }), bankRow("2026-09-02", -2_000, { category: "other", categorySource: "default" })], {});
    await w.put(
      [row("f1", "a-file", "2026-09-01", -10_001, "csv", "booked", { category: "groceries", categorySource: "user" }), row("f2", "a-file", "2026-09-02", -2_000, "csv", "booked", { category: "fun", categorySource: "rule" })],
      {},
    );

    await foldCsvAccounts(w.repo);

    expect(await stateOf(w, a)).toEqual({ category: "travel", category_source: "user", is_transfer: 0 });
    expect(await stateOf(w, b)).toEqual({ category: "other", category_source: "default", is_transfer: 0 });
  });
});
