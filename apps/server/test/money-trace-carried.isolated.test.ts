/**
 * What a pool cut by who paid it keeps when its users change or another pool's money is carried into it, and what one
 * failing build leaves alone: money carried from a pool of other users, an answer whose owner stops being a user, the
 * split that leaving it says nothing of, and a build that throws. Made-up names and sums; the first user by id is "Aino".
 */
import { describe, expect, it, vi } from "vitest";
import { requestInputs } from "../src/services/analysis.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { settledTrace } from "../src/services/money-trace.ts";
import { AINO, fromAino, IBAN, link, people, type R, raw, VILLE, type World } from "./trace-world.ts";

// a trace of a pool with a row of -666,00 is refused, as core refuses rows it cannot share out
vi.mock("@banking/core", async (importOriginal) => {
  const core = await importOriginal<typeof import("@banking/core")>();
  return {
    ...core,
    trace: (...args: Parameters<typeof core.trace>) => {
      if (args[0].some((r) => r.cents === -66600)) throw new Error("a share is larger than what its owner holds");
      return core.trace(...args);
    },
  };
});

const CEC = "KOSKINEN CECILIA";
const POOL_Y = "FI7000000000000007";
const YEAR = "from=2026-01-01&to=2026-12-31";
type Client = World["admin"];

const put = async (w: World, userId: string, id: string, rows: R[], balance: number) => {
  await w.db.run("UPDATE accounts SET balance_cents = ? WHERE id = ?", [balance, id]);
  await ingestTransactions(w.s.finance(userId), id, rows.map(raw), "enablebanking");
};
const split = (c: Client, id: string) => c.call("PUT", `/api/accounts/${id}/split`, { mode: "source" });
const listOf = async (c: Client, id: string) => (await c.call("GET", `/api/transactions?scope=own&accountId=${id}&${YEAR}&limit=500`)).body;
const metaOf = async (c: Client, id: string) => (await c.call("GET", "/api/meta")).body.accounts.find((a: { id: string }) => a.id === id);
const balanceOf = async (w: World, userId: string, scope: "own" | "household", id: string) => {
  const data = await w.s.analysis.get(w.s, userId, scope);
  return (await requestInputs(w.s, userId, data.accounts)).balances.find((b) => b.id === id)!.balanceCents!;
};
type Item = { bookingDate: string; amountCents: number; counterparty: string; partCents: number; openCents?: number };
const row = (b: { items: Item[] }, date: string, euros: number): Item => b.items.find((t) => t.bookingDate === date && t.amountCents === Math.round(euros * 100))!;

/** Pool X is used by Aino and the second member; it sends 500,00 to pool Y, used by Aino and Ville. */
async function carried(secondInX: "cecilia" | "ville", more: R[] = []) {
  const w = await people({ at: new Date("2026-10-09T10:00:00Z") });
  const cec = await w.member("cecilia", "Cecilia");
  await link(w, cec.id, "cecilia-own", CEC, IBAN.cecilia, "idn-cecilia");
  const second = secondInX === "cecilia" ? { name: CEC, iban: IBAN.cecilia } : { name: VILLE, iban: IBAN.ville };
  await link(w, w.aino, "x-a", `${AINO}, ${second.name}`, IBAN.pool, "idn-x");
  await put(w, w.aino, "x-a", [fromAino("2026-09-01", 600), ["2026-09-01", 400, second.name, second.iban], ["2026-09-05", -500, "POOL Y", POOL_Y]], 50000);
  await link(w, w.aino, "y-a", `${AINO}, ${VILLE}`, POOL_Y, "idn-y");
  const y: R[] = [["2026-09-05", 500, "POOL X", IBAN.pool], ["2026-09-06", -450, "ASUNTO OY ESIMERKKI"], ...more];
  await put(w, w.aino, "y-a", y, y.reduce((n, r) => n + Math.round(r[1] * 100), 0));
  await w.s.household.share(w.aino, "y-a", w.ville);
  await w.s.household.share(w.aino, "x-a", secondInX === "cecilia" ? cec.id : w.ville);
  expect((await split(w.as(w.aino), "x-a")).status).toBe(200);
  expect((await split(w.as(w.aino), "y-a")).status).toBe(200);
  return w;
}

/** A row of pool Y as the two members' own lists say it: the cents of each, and how much of each is unknown money a question stands for. */
async function ySides(w: World, date: string, euros: number) {
  const [aino, ville] = [row(await listOf(w.as(w.aino), "y-a"), date, euros), row(await listOf(w.as(w.ville), "y-a"), date, euros)];
  return { aino: aino.partCents, ville: ville.partCents, open: [Math.abs(aino.openCents ?? 0), Math.abs(ville.openCents ?? 0)] };
}

describe("money carried from a pool of other users", () => {
  it("a part of a member who uses no part of the receiving pool is unknown money, asked about, and every cent is in a view or in the question", async () => {
    const w = await carried("cecilia");
    const y = (await settledTrace(w.s, "idn-y"))!;
    expect(y.questions).toEqual([expect.objectContaining({ kind: "in", key: `g:iban:${IBAN.pool}`, cents: 20000 })]);
    // the money in: Aino's 300,00 is hers, the 200,00 of Cecilia is unknown money the two share and the question holds
    expect(await ySides(w, "2026-09-05", 500)).toEqual({ aino: 40000, ville: 10000, open: [10000, 10000] });
    // the rent was paid 270,00 of Aino's and 180,00 of unknown money
    expect(await ySides(w, "2026-09-06", -450)).toEqual({ aino: -36000, ville: -9000, open: [9000, 9000] });
    // what is left, 50,00, is Aino's 30,00 and the 20,00 nobody owns, which the two share: nothing is lost on the way
    expect([await balanceOf(w, w.aino, "own", "y-a"), await balanceOf(w, w.ville, "own", "y-a"), await balanceOf(w, w.aino, "household", "y-a")]).toEqual([4000, 1000, 5000]);
  });

  it("near miss: where the member is a user of the receiving pool as well, it asks nothing and the lists add up whole", async () => {
    const w = await carried("ville");
    expect((await settledTrace(w.s, "idn-y"))!.questions).toEqual([]);
    expect(await ySides(w, "2026-09-05", 500)).toEqual({ aino: 30000, ville: 20000, open: [0, 0] });
    expect(await ySides(w, "2026-09-06", -450)).toEqual({ aino: -27000, ville: -18000, open: [0, 0] });
    expect([await balanceOf(w, w.aino, "own", "y-a"), await balanceOf(w, w.ville, "own", "y-a")]).toEqual([3000, 2000]);
  });

  it("money out and a refund of the rent in the same world: each row adds up with the question in both lists and the balances add up to the account's", async () => {
    const w = await carried("cecilia", [["2026-09-07", -30, "SAHKO OY"], ["2026-09-08", 450, "ASUNTO OY ESIMERKKI"]]);
    const [ainos, villes] = [await listOf(w.as(w.aino), "y-a"), await listOf(w.as(w.ville), "y-a")];
    for (const t of ainos.items as Item[]) {
      const other = row(villes, t.bookingDate, t.amountCents / 100);
      expect(t.partCents + other.partCents, `${t.bookingDate} ${t.amountCents}`).toBe(t.amountCents);
    }
    // the refund goes back to who paid the rent: Aino's 270,00 and the unknown money's 180,00, which the two share
    expect(await ySides(w, "2026-09-08", 450)).toEqual({ aino: 36000, ville: 9000, open: [9000, 9000] });
    const [a, v, h] = [await balanceOf(w, w.aino, "own", "y-a"), await balanceOf(w, w.ville, "own", "y-a"), await balanceOf(w, w.aino, "household", "y-a")];
    expect([a + v, h]).toEqual([47000, 47000]);
  });
});

describe("an answer whose owner stops being a user", () => {
  const pool = async () => {
    const w = await people({ at: new Date("2026-10-09T10:00:00Z") });
    await link(w, w.aino, "pool-a", `${AINO}, ${VILLE}`, IBAN.pool, "idn-pool");
    await put(w, w.aino, "pool-a", [fromAino("2026-09-01", 1000), ["2026-09-02", 500, "TUNTEMATON OY"], ["2026-09-05", -1200, "ASUNTO OY ESIMERKKI"]], 30000);
    await w.s.household.share(w.aino, "pool-a", w.ville);
    expect((await split(w.as(w.aino), "pool-a")).status).toBe(200);
    const q = (await metaOf(w.as(w.aino), "pool-a")).questions[0];
    const said = await w.as(w.aino).call("PUT", "/api/accounts/pool-a/answers", { kind: q.kind, key: q.key, owner: `u:${w.ville}` });
    expect(said.status).toBe(200);
    return w;
  };
  const rent = async (w: World, other: Client) => {
    const [a, b] = [row(await listOf(w.as(w.aino), "pool-a"), "2026-09-05", -1200), row(await listOf(other, "pool-a"), "2026-09-05", -1200)];
    return { aino: a.partCents, other: b.partCents, open: Math.abs(a.openCents ?? 0) + Math.abs(b.openCents ?? 0) };
  };

  it("the question stands again, the rent adds up with it, the balances add up and /meta serves no answer of the one who left", async () => {
    const w = await pool();
    expect(await rent(w, w.as(w.ville))).toEqual({ aino: -80000, other: -40000, open: 0 });
    expect(await metaOf(w.as(w.aino), "pool-a")).toMatchObject({ answers: [expect.objectContaining({ owner: `u:${w.ville}` })] });
    const cec = await w.member("cecilia", "Cecilia");
    await link(w, cec.id, "cecilia-own", CEC, IBAN.cecilia, "idn-cecilia");
    await w.s.household.share(w.aino, "pool-a", cec.id);
    expect((await w.as(w.aino).call("PUT", "/api/accounts/pool-a/use", { users: [{ userId: w.aino, weight: 1 }, { userId: cec.id, weight: 1 }] })).status).toBe(200);
    expect((await split(w.as(w.aino), "pool-a")).status).toBe(200);
    const after = await rent(w, cec);
    expect(after.open).toBeGreaterThan(0);
    expect(after.aino + after.other).toBe(-120000);
    const meta = await metaOf(w.as(w.aino), "pool-a");
    expect(meta.answers ?? []).toEqual([]);
    expect(meta.questions).toEqual([expect.objectContaining({ kind: "in", cents: 50000 })]);
    const [a, c, h] = [await balanceOf(w, w.aino, "own", "pool-a"), await balanceOf(w, cec.id, "own", "pool-a"), await balanceOf(w, w.aino, "household", "pool-a")];
    expect([a + c, h]).toEqual([30000, 30000]);
  });

  it("near miss: the weights change and the users stay, and the answer stays", async () => {
    const w = await pool();
    expect((await w.as(w.aino).call("PUT", "/api/accounts/pool-a/use", { users: [{ userId: w.aino, weight: 3 }, { userId: w.ville, weight: 1 }] })).status).toBe(200);
    expect((await split(w.as(w.aino), "pool-a")).status).toBe(200);
    const meta = await metaOf(w.as(w.aino), "pool-a");
    expect(meta.answers).toEqual([expect.objectContaining({ owner: `u:${w.ville}` })]);
    expect(meta.questions ?? []).toEqual([]);
    expect(await rent(w, w.as(w.ville))).toEqual({ aino: -80000, other: -40000, open: 0 });
  });

  it("a member who is removed takes the answers that name them, and the answers that name another stay", async () => {
    const w = await pool();
    const count = async (owner: string) => (await w.db.all<{ n: number }>("SELECT COUNT(*) AS n FROM owner_answer WHERE owner = ?", [owner]))[0]!.n;
    expect([await count(`u:${w.ville}`), await count(`u:${w.aino}`)]).toEqual([1, 0]);
    await w.s.household.setAnswer("idn-pool", "in", "g:text:other", `u:${w.aino}`, w.aino, "2026-10-09T10:00:00.000Z");
    await w.s.household.removeMember(w.ville);
    expect([await count(`u:${w.ville}`), await count(`u:${w.aino}`)]).toEqual([0, 1]);
  });
});

describe("leaving the split of an account", () => {
  const useRows = async (w: World) => (await w.db.all<{ n: number }>("SELECT COUNT(*) AS n FROM account_use"))[0]!.n;

  it("an account with no split row says nothing: no use is stored and it follows the bank's holders as before", async () => {
    const w = await people({ at: new Date("2026-10-09T10:00:00Z") });
    const before = (await metaOf(w.as(w.aino), "aino-own")).use;
    expect((await w.as(w.aino).call("DELETE", "/api/accounts/aino-own/split")).status).toBe(200);
    expect(await useRows(w)).toBe(0);
    expect((await metaOf(w.as(w.aino), "aino-own")).use).toEqual(before);
  });

  it("near miss: a pool with a split row gets the weights it has now said", async () => {
    const w = await pool2();
    expect(await useRows(w)).toBe(0);
    expect((await w.as(w.aino).call("DELETE", "/api/accounts/pool-a/split")).status).toBe(200);
    expect(await useRows(w)).toBe(2);
    expect((await metaOf(w.as(w.aino), "pool-a")).use.source).toBe("said");
  });
  async function pool2() {
    const w = await people({ at: new Date("2026-10-09T10:00:00Z") });
    await link(w, w.aino, "pool-a", `${AINO}, ${VILLE}`, IBAN.pool, "idn-pool");
    await put(w, w.aino, "pool-a", [fromAino("2026-09-01", 1000), ["2026-09-05", -400, "ASUNTO OY ESIMERKKI"]], 60000);
    await w.s.household.share(w.aino, "pool-a", w.ville);
    expect((await split(w.as(w.aino), "pool-a")).status).toBe(200);
    return w;
  }
});

describe("a trace that throws", () => {
  /** Two pools of Aino and Ville; the first has a row of `refused` euros out. */
  async function twoPools(refused: number) {
    const w = await people({ at: new Date("2026-10-09T10:00:00Z") });
    for (const [id, identity, iban, out] of [["bad-a", "idn-bad", IBAN.pool, refused], ["good-a", "idn-good", POOL_Y, -300]] as const) {
      await link(w, w.aino, id, `${AINO}, ${VILLE}`, iban, identity);
      await put(w, w.aino, id, [fromAino("2026-09-01", 1000), ["2026-09-05", out, "ASUNTO OY ESIMERKKI"]], 100000 + out * 100);
      await w.s.household.share(w.aino, id, w.ville);
      expect((await split(w.as(w.aino), id)).status).toBe(200);
    }
    return w;
  }

  it("serves that pool as not traced to both members, with a line in the log without a name or a sum, and the other pool stays traced", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const w = await twoPools(-666);
      const accounts = (await w.as(w.aino).call("GET", "/api/meta")).body.accounts;
      expect(["bad-a", "good-a"].map((id) => !!accounts.find((a: { id: string }) => a.id === id).traced)).toEqual([false, true]);
      for (const who of [w.aino, w.ville]) {
        expect((await w.as(who).call("GET", "/api/meta")).status).toBe(200);
        const list = await w.as(who).call("GET", `/api/transactions?scope=own&accountId=bad-a&${YEAR}&limit=50`);
        expect(list.status).toBe(200);
        // cut by the part, as before the split (equal weights); the other pool is still cut by who paid, which was Aino
        expect(row(list.body, "2026-09-05", -666).partCents).toBe(-33300);
        expect(row(await listOf(w.as(who), "good-a"), "2026-09-05", -300).partCents).toBe(who === w.aino ? -30000 : 0);
      }
      expect(log).toHaveBeenCalled();
      for (const [line] of log.mock.calls) expect(String(line)).not.toMatch(/\d|MEIKALAINEN|LAHTINEN|FI\d|idn-/i);
    } finally {
      log.mockRestore();
    }
  });

  it("near miss: the same world without the refused row is traced", async () => {
    const w = await twoPools(-665);
    const meta = (await w.as(w.aino).call("GET", "/api/meta")).body.accounts;
    expect(meta.map((a: { id: string; traced?: true }) => [a.id, !!a.traced]).filter(([id]: [string]) => id.endsWith("-a") && id !== "aino-own")).toEqual([["bad-a", true], ["good-a", true]]);
  });
});
