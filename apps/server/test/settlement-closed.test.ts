/**
 * A closed month of a joint account is final: a cost whose split is not told today leaves the stored month as it was
 * settled and brings no correction to the month after. Made-up names and sums.
 */
import { transfersOf } from "@banking/core";
import { describe, expect, it } from "vitest";
import { cents, fromAino, fromVille, type R, world } from "./trace-world.ts";

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
});
