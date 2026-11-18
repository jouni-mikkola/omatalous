/**
 * A closed month of a joint account is final: a cost whose split is not told today leaves the stored month as it was
 * settled and brings no correction to the month after. Made-up names and sums.
 */
import { transfersOf } from "@banking/core";
import { describe, expect, it } from "vitest";
import { usesSaidOn } from "../src/services/settlement-inputs.ts";
import { cents, fromAino, fromVille, KEY, type R, type World, world } from "./trace-world.ts";

const MONTH = "2026-09";
const ROWS: R[] = [fromAino("2026-09-01", 1000), fromVille("2026-09-02", 600), ["2026-09-05", -800, "ESIMERKKI KIINTEISTÖT OY"], ["2026-09-10", -100, "ESIMERKKI OY"], ["2026-10-03", -50, "ESIMERKKI OY"]];

describe("a closed month of a joint account", () => {
  it("stays as it was settled when the split of its costs is not told today, and the month after asks for no transfer", async () => {
    const w = await world({ copies: [{ by: "aino", id: "pool-a", rows: ROWS }, { by: "ville", id: "pool-v", rows: ROWS }], balance: cents(ROWS), said: true });
    const read = async (month: string) => {
      const res = await w.as(w.aino).call("GET", `/api/settlement?month=${month}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.pools[0].settlement;
    };
    // the split was said when September closed: both partners owe half of the 900,00
    const sep = await read(MONTH);
    expect(sep.status.open).toBe(false);
    expect(sep.members.map((m: any) => m.owed)).toEqual([45000, 45000]);
    expect(sep.untold).toBeUndefined();

    // the said split goes: the names alone tell none, so every cost of the account is untold
    await w.db.run("DELETE FROM account_use");
    await w.s.settings.bumpUserDataVersion(w.aino);
    await w.s.settings.bumpUserDataVersion(w.ville);

    expect(await read(MONTH)).toEqual(sep);
    const october = await read("2026-10");
    expect(october.status.open).toBe(true);
    expect(october.untold).toMatchObject([{ cents: 5000 }]);
    expect(october.lines.filter((l: any) => l.kind === "late_change")).toEqual([]);
    expect(october.members.map((m: any) => [m.paid, m.owed, m.over])).toEqual([[0, 0, 0], [0, 0, 0]]);
    expect(transfersOf(october.members)).toEqual([]);
  });

  it("dates the use and a split a member chose by when they were said, and a split the app set not at all", async () => {
    const w = await world({ copies: [{ by: "aino", id: "pool-a", rows: ROWS }], balance: cents(ROWS), said: true });
    // the use was said when the world was made, on 9.10.
    expect(await usesSaidOn(w.s, [KEY])).toEqual(new Map([[KEY, "2026-10-09"]]));
    await w.db.run("INSERT OR REPLACE INTO account_split (account_key, mode, set_by, set_at) VALUES (?, 'source', NULL, ?)", [KEY, "2026-11-02T12:00:00Z"]);
    expect(await usesSaidOn(w.s, [KEY])).toEqual(new Map([[KEY, "2026-10-09"]]));
    await w.db.run("UPDATE account_split SET set_by = ? WHERE account_key = ?", [w.aino, KEY]);
    expect(await usesSaidOn(w.s, [KEY])).toEqual(new Map([[KEY, "2026-11-02"]]));
    // what was taken back has no day
    await w.db.run("DELETE FROM account_use");
    await w.db.run("DELETE FROM account_split");
    expect(await usesSaidOn(w.s, [KEY])).toEqual(new Map());
  });

  it("puts an agreement in force on the day its last partner puts it, the day a closed month reads it by", async () => {
    const w = await world({ copies: [{ by: "aino", id: "pool-a", rows: ROWS }, { by: "ville", id: "pool-v", rows: ROWS }], balance: cents(ROWS), said: true });
    const body = { validFrom: "2026-01-01", kind: "income", value: { who: [`u:${w.aino}`, `u:${w.ville}`] } };
    expect((await w.as(w.aino).call("PUT", "/api/settlement/agreements/pool-a", body)).status).toBe(200);
    w.clock.at = new Date("2026-11-05T10:00:00Z");
    expect((await w.as(w.ville).call("PUT", "/api/settlement/agreements/pool-v", body)).status).toBe(200);
    const [row] = await w.db.all<{ set_at: string }>("SELECT set_at FROM account_agreement WHERE kind = 'income'");
    expect(row?.set_at).toBe("2026-11-05T10:00:00.000Z");
  });

  it("takes a month in an import whose correction was stored before corrections recorded their rows", async () => {
    const STRANGER = "FI7700000000000007";
    const rows: R[] = [fromAino("2026-09-01", 1000), ["2026-09-02", 200, "ESIMERKKI OY", STRANGER], ["2026-09-05", -600, "ESIMERKKI KIINTEISTÖT OY"]];
    const w = await world({ copies: [{ by: "aino", id: "pool-a", rows }, { by: "ville", id: "pool-v", rows }], balance: cents(rows), said: true });
    const say = (owner: string) => w.as(w.aino).call("PUT", "/api/accounts/pool-a/answers", { kind: "in", key: `g:iban:${STRANGER}`, owner });
    const read = (month: string) => w.as(w.aino).call("GET", `/api/settlement?month=${month}`);
    const kept = () => w.db.all<{ month: string; closed_on: string; snapshot: string }>("SELECT month, closed_on, snapshot FROM settlement_closed ORDER BY month");
    // September closes with the payer said, the payer is changed after, and October closes with the correction
    expect((await say(`u:${w.ville}`)).status).toBe(200);
    await read(MONTH);
    w.clock.at = new Date("2026-10-14T10:00:00Z");
    expect((await say(`u:${w.aino}`)).status).toBe(200);
    w.clock.at = new Date("2026-11-05T10:00:00Z");
    await read("2026-10");
    const oct = (await kept()).find((r) => r.month === "2026-10")!;
    const lines = JSON.parse(oct.snapshot).lines;
    expect(lines.filter((l: any) => l.kind === "late_change").map((l: any) => l.byRow?.length)).toEqual([1]);
    await w.db.run("DELETE FROM settlement_closed WHERE month = '2026-10'");
    // the same month as an earlier version stored it: the correction has no rows
    const unrecorded = JSON.stringify({ ...JSON.parse(oct.snapshot), lines: lines.map(({ byRow: _r, ...l }: any) => l) });
    const made = await importAs(w, w.aino, [{ account_key: KEY, month: "2026-10", closed_on: oct.closed_on, snapshot: unrecorded, written_at: "2026-11-01T00:00:00.000Z" }]);
    expect(made).toMatchObject({ add: 1, exists: 0 });
  });
});

/** Sends closed months as the member's own import and answers the count of that store. */
async function importAs(w: World, userId: string, settlementClosed: unknown[]) {
  const c = w.as(userId);
  const f = (await c.call("POST", "/api/data/export", {})).body;
  const head = typeof f === "string" ? JSON.parse(f) : f;
  const id = (await c.call("POST", "/api/data/import", { format: head.format, version: head.version, appVersion: head.appVersion, exportedAt: head.exportedAt })).body.session as string;
  expect((await c.call("POST", `/api/data/import/${id}/chunk`, { seq: 0, stores: { settlementClosed } })).status).toBe(200);
  expect((await c.call("POST", `/api/data/import/${id}/check`, {})).status).toBe(200);
  const done = await c.call("POST", `/api/data/import/${id}/commit`, {});
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  return (done.body.stores as { key: string }[]).find((x) => x.key === "settlementClosed");
}
