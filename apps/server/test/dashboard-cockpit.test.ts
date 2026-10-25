/**
 * What the front page's cockpit reads from GET /api/dashboard: the month waterfall (its bars add up to Tulos), the
 * running month's settlement of the pools the viewer is weighted in, and the reconcile verdict of each account.
 * Made-up names and sums; the first user by id is "Aino".
 */
import { describe, expect, it } from "vitest";
import { ingestTransactions } from "../src/services/ingest.ts";
import { setupApp, waitFor } from "./helpers.ts";
import { cents, fromAino, fromVille, KEY, type R, raw, type World, world } from "./trace-world.ts";

/** 1000,00 from Aino and 600,00 from Ville, then rent 800,00 and a shop 100,00 in the running month: Aino paid 562,50 of the 900,00 and Ville 337,50. */
const OCTOBER: R[] = [fromAino("2026-10-01", 1000), fromVille("2026-10-02", 600), ["2026-10-05", -800, "ESIMERKKI KIINTEISTÖT OY"], ["2026-10-06", -100, "ESIMERKKI OY"]];
const RUNNING = "from=2026-10-01&to=2026-10-31";
const both = (rows: R[], over: Partial<Parameters<typeof world>[0]> = {}) => world({ copies: [{ by: "aino", id: "pool-a", rows }, { by: "ville", id: "pool-v", rows }], balance: cents(rows), said: true, ...over });

/** The administrator is called Aino and the other member Ville, whichever has the lower id. */
const nameOf = (w: World, id: string) => (id === w.adminId ? "Aino" : "Ville");
type Line = { owner: string; name: string; overCents: number };
const dashboard = async (w: World, userId: string, scope: "own" | "household" = "own", query = RUNNING) => {
  const res = await w.as(userId).call("GET", `/api/dashboard?${query}&scope=${scope}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
};
const bars = (d: { waterfall: { bars: { cents: number }[] } }) => d.waterfall.bars.reduce((n, b) => n + b.cents, 0);

describe("the dashboard settlement of the running month", () => {
  it("names the users of each pool the viewer is weighted in, with what they paid over their share", async () => {
    const w = await both(OCTOBER);
    const [a, v] = [`u:${w.aino}`, `u:${w.ville}`];
    for (const viewer of [w.aino, w.ville]) {
      const { settlement } = await dashboard(w, viewer);
      expect(settlement).toEqual([{ accountKey: KEY, month: "2026-10", lines: expect.any(Array) }]);
      expect(Object.fromEntries((settlement[0].lines as Line[]).map((l) => [l.owner, [l.name, l.overCents]]))).toEqual({ [a]: [nameOf(w, w.aino), 11250], [v]: [nameOf(w, w.ville), -11250] });
      expect(Object.keys(settlement[0].lines[0]).sort()).toEqual(["name", "overCents", "owner"]);
    }
  });

  it("has the same lines in the own view and the household view", async () => {
    const w = await both(OCTOBER);
    expect((await dashboard(w, w.aino, "household")).settlement).toEqual((await dashboard(w, w.aino, "own")).settlement);
  });

  it("gives a member who only sees the pool no line of it, and names no user whose weight is zero", async () => {
    const w = await both(OCTOBER);
    const cecilia = await w.member("cecilia", "Cecilia");
    expect(await w.s.household.share(w.aino, "pool-a", cecilia.id)).toBe(true);
    // she sees the account and is no user of it: an empty list
    const seen = await cecilia.call("GET", `/api/dashboard?${RUNNING}&scope=household`);
    expect(seen.status).toBe(200);
    expect(seen.body.settlement).toEqual([]);
    // she is a user with weight zero: still none for her, and nobody else's answer names her
    await w.s.household.setUse(KEY, [{ userId: w.aino, weight: 1 }, { userId: w.ville, weight: 1 }, { userId: cecilia.id, weight: 0 }], w.aino, "2026-10-01T00:00:00.000Z");
    expect((await cecilia.call("GET", `/api/dashboard?${RUNNING}`)).body.settlement).toEqual([]);
    const { settlement } = await dashboard(w, w.aino);
    expect(settlement[0].lines).toHaveLength(2);
    expect(JSON.stringify(settlement)).not.toContain("Cecilia");
    expect(JSON.stringify(settlement)).not.toContain(cecilia.id);
  });

  it("ignores an income agreement that waits for the partner, as the settlement page does", async () => {
    const w = await both(OCTOBER);
    const [a, v] = [`u:${w.aino}`, `u:${w.ville}`];
    const before = (await dashboard(w, w.aino)).settlement;
    const put = await w.as(w.aino).call("PUT", "/api/settlement/agreements/pool-a", { validFrom: "2026-10-01", kind: "income", value: { who: [a, v] } });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.agreements[0].pending).toBeTruthy();
    expect((await dashboard(w, w.aino)).settlement).toEqual(before);
    // near miss: an agreement in force changes the lines
    expect((await w.as(w.aino).call("PUT", "/api/settlement/agreements/pool-a", { validFrom: "2026-10-02", kind: "share", value: { weights: { [a]: 3, [v]: 1 } } })).status).toBe(200);
    const after = (await dashboard(w, w.aino)).settlement;
    expect((after[0].lines as Line[]).map((l) => l.overCents)).not.toEqual((before[0].lines as Line[]).map((l) => l.overCents));
  });

  it("leaves a pool with a long unfrozen history out until it is frozen on the side, then says what the settlement page says", async () => {
    const months = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"];
    const rows: R[] = months.flatMap((m): R[] => [fromAino(`2026-${m}-01`, 1000), fromVille(`2026-${m}-02`, 600), [`2026-${m}-05`, -800, "ESIMERKKI KIINTEISTÖT OY"], [`2026-${m}-06`, -100, "ESIMERKKI OY"]]);
    const w = await both(rows);
    // nine months have no snapshot: the first answer does not wait for them
    expect((await dashboard(w, w.aino)).settlement).toEqual([]);
    await waitFor(async () => (await dashboard(w, w.aino)).settlement.length === 1, 15_000);
    const page = (await w.as(w.aino).call("GET", "/api/settlement?month=2026-10")).body.pools[0].settlement.members as { owner: string; over: number }[];
    const lines = (await dashboard(w, w.aino)).settlement[0].lines as Line[];
    expect(lines.map((l) => [l.owner, l.overCents]).sort()).toEqual(page.map((m) => [m.owner, m.over]).sort());
  }, 20_000);

  it("is an empty list for a household with no pool", async () => {
    const { admin } = await setupApp();
    expect((await admin.call("GET", "/api/dashboard")).body.settlement).toEqual([]);
  });
});

describe("the dashboard waterfall", () => {
  it("is for the month the range ends in, and the own view and the household view count their own rows", async () => {
    const aino: R[] = [["2026-10-03", 2000, "ESIMERKKI TYÖNANTAJA OY"]];
    // the same household twice, Aino's own account shared with Ville, with and without 2 000,00 on it
    const shared = (rows: R[]) => both(OCTOBER, { share: true, extra: async (x) => void (await ingestTransactions(x.s.finance(x.aino), "aino-own", rows.map(raw), "enablebanking")) });
    const [w, bare] = [await shared(aino), await shared([])];
    const [mine, theirs] = [await dashboard(w, w.ville, "own"), await dashboard(w, w.ville, "household")];
    expect(mine.waterfall.month).toBe("2026-10");
    expect(bars(mine)).toBe(mine.waterfall.leftCents);
    // the shop payment nobody classified is the category Muut menot, and the sum still holds with it
    expect(mine.waterfall.bars.map((b: { key: string }) => b.key)).toContain("category:other");
    expect(bars(theirs)).toBe(theirs.waterfall.leftCents);
    // Aino's account is shared with Ville: the household view holds its 2 000,00, the own view does not
    expect(theirs.waterfall.leftCents - (await dashboard(bare, bare.ville, "household")).waterfall.leftCents).toBe(200000);
    expect(mine.waterfall.leftCents - (await dashboard(bare, bare.ville, "own")).waterfall.leftCents).toBe(0);
    // a month with no rows has none, a range from after today has none
    expect((await dashboard(w, w.ville, "own", "from=2026-05-01&to=2026-05-31")).waterfall).toBeNull();
    expect((await dashboard(w, w.ville, "own", "from=2026-11-01&to=2026-11-30")).waterfall).toBeNull();
  });
});

describe("the dashboard on the demo household", () => {
  it("has bars that add up to Tulos in every month, and the reconcile word of the Tilit page on each account", async () => {
    const app = await setupApp();
    expect((await app.admin.call("POST", "/api/demo")).status).toBe(200);
    const meta = (await app.admin.call("GET", "/api/meta")).body.accounts as { id: string; reconcile: { status: string } | null }[];
    const word: Record<string, string> = { proved: "ok", differs: "diff", unknown: "unknown" };
    let months = 0;
    const seen = new Set<string>();
    for (const scope of ["own", "household"] as const) {
      for (let i = 0; i < 14; i++) {
        const month = new Date(Date.UTC(2025, 8 + i, 1)).toISOString().slice(0, 7);
        const last = new Date(Date.UTC(2025, 9 + i, 0)).toISOString().slice(0, 10);
        const d = (await app.admin.call("GET", `/api/dashboard?from=${month}-01&to=${last}&scope=${scope}`)).body;
        if (!d.waterfall) continue;
        months++;
        expect(d.waterfall.month).toBe(month);
        expect(bars(d)).toBe(d.waterfall.leftCents);
        for (const b of d.waterfall.bars as { key: string }[]) seen.add(b.key.split(":")[0]!);
        expect(d.waterfall.bars[0].key).toBe("income");
        expect(d.waterfall.bars.filter((b: { key: string }) => b.key.startsWith("category:")).length).toBeLessThanOrEqual(9);
        // the waterfall and the table under it are one month's figures: Tulot, and Menot as the spending bars
        const waterfall = d.waterfall.bars as { key: string; cents: number }[];
        expect(waterfall[0]!.cents).toBe(d.totals.incomeCents);
        expect(-waterfall.filter((b) => b.key.startsWith("category:") || b.key === "other").reduce((n, b) => n + b.cents, 0)).toBe(d.totals.expenseCents);
        expect(d.settlement).toEqual([]);
        expect(d.holdings.accounts.length).toBeGreaterThan(0);
        for (const a of d.holdings.accounts as { id: string; reconcile: string }[]) {
          const result = meta.find((m) => m.id === a.id)?.reconcile;
          expect(a.reconcile).toBe(result ? word[result.status] : "unknown");
        }
      }
    }
    expect(months).toBeGreaterThan(20);
    // the demo has transfers between its accounts, and none of them breaks the sum
    expect(seen.has("transfers")).toBe(true);
  });
});
