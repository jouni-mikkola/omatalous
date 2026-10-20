/**
 * GET /accounts/:id/sources: what each member of a joint account paid in, bore and moved, month by month, to the cent.
 * Made-up names and sums; the first user by id is "Aino".
 */
import { describe, expect, it } from "vitest";
import { cents, fromAino, fromVille, IBAN, link, one, type R, type World, world } from "./trace-world.ts";

const share = async (w: World) => {
  expect(await w.s.household.share(w.aino, "pool-a", w.ville)).toBe(true);
  expect((await w.as(w.aino).call("PUT", "/api/accounts/pool-a/split", { mode: "source" })).body).toEqual({ ok: true });
};
const withCredit = async (w: World) => {
  await link(w, w.ville, "ville-credit", "LAHTINEN VILLE", IBAN.card, "idn-credit", "credit_card");
  await share(w);
};

interface Column {
  userId: string | null;
  paidInCents: number;
  costsCents: number;
  movedCents: number;
  takenCents: number;
  leftCents: number;
}
/** The figures of one month as [Aino, Ville, the rest] for each row of the table. */
async function month(w: World, as: string, wanted: string, id = "pool-a") {
  const res = await w.as(as).call("GET", `/api/accounts/${id}/sources`);
  expect(res.status).toBe(200);
  const m = (res.body.months as { month: string; columns: Column[] }[]).find((x) => x.month === wanted)!;
  expect(m.columns.map((c) => c.userId)).toEqual([w.aino, w.ville, null]);
  const by = (f: Exclude<keyof Column, "userId">) => m.columns.map((c) => c[f]);
  return { paidIn: by("paidInCents"), costs: by("costsCents"), moved: by("movedCents"), taken: by("takenCents"), left: by("leftCents"), months: (res.body.months as { month: string }[]).map((x) => x.month) };
}

describe("the months of a joint account", () => {
  it("T11: the pair, with the mortgage on the 3rd, as the member it is shared with sees it", async () => {
    const rows: R[] = [fromAino("2026-08-01", 1150), ["2026-08-03", -1104.37, "ESIMERKKI PANKKI"], fromVille("2026-08-04", 400), ["2026-08-05", -400, "MEIKALAINEN AINO", IBAN.aino]];
    const w = await world(one(rows, 0, { extra: share }));
    for (const who of [w.aino, w.ville]) {
      const aug = await month(w, who, "2026-08");
      expect(aug).toMatchObject({ paidIn: [115000, 40000, 0], costs: [110437, 0, 0], moved: [0, 40000, 0], left: [4563, 0, 0], taken: [40000, 0, 0] });
    }
  });

  it("a refund in the month after its purchase makes that month's costs negative and is no money paid in", async () => {
    const rows: R[] = [fromAino("2026-07-01", 1150), fromVille("2026-07-01", 50), ["2026-07-05", -45.63, "ESIMERKKIMAKSUT OY"], ["2026-08-10", 45.63, "ESIMERKKIMAKSUT OY"]];
    const w = await world(one(rows, 0, { extra: share }));
    const aug = await month(w, w.aino, "2026-08");
    expect(aug).toMatchObject({ paidIn: [0, 0, 0], costs: [-4373, -190, 0], left: [115000, 5000, 0] });
    expect(aug.months).toEqual(["2026-08", "2026-07"]);
    expect(await month(w, w.aino, "2026-07")).toMatchObject({ paidIn: [115000, 5000, 0], costs: [4373, 190, 0], left: [110627, 4810, 0] });
    // near miss: the same 45,63 from a payer is money paid in
    const gift = await world(one([...rows.slice(0, 3), fromAino("2026-08-10", 45.63)], 0, { extra: share }));
    expect(await month(gift, gift.aino, "2026-08")).toMatchObject({ paidIn: [4563, 0, 0], costs: [0, 0, 0] });
  });

  it("S17: the payer bears the shared bills whole, the other's takings are passed, and nothing lands on him by a weight nobody said", async () => {
    const rows: R[] = [fromAino("2026-09-01", 1000), ["2026-09-03", -300, "LAHTINEN VILLE", IBAN.ville], ["2026-09-04", -80, "VISA", IBAN.card], ["2026-09-05", -600, "ASUNTO OY ESIMERKKI"]];
    const w = await world(one(rows, 0, { extra: withCredit }));
    expect(await month(w, w.ville, "2026-09")).toMatchObject({ paidIn: [100000, 0, 0], costs: [60000, 0, 0], moved: [38000, 0, 0], taken: [0, 38000, 0], left: [2000, 0, 0] });
    // near miss: what he paid in himself he takes back as his own, and only the rest is passed
    const paid = await world(one([fromAino("2026-09-01", 1000), fromVille("2026-09-02", 200), ...rows.slice(1)], 0, { extra: withCredit }));
    expect(await month(paid, paid.aino, "2026-09")).toMatchObject({ paidIn: [100000, 20000, 0], moved: [18000, 20000, 0], taken: [0, 18000, 0], costs: [60000, 0, 0], left: [22000, 0, 0] });
  });

  it("S18: a member who never touches the pool bears 0,00 of every bill; near miss: he paid in 100,00 first", async () => {
    const rows: R[] = [fromAino("2026-09-01", 900), ["2026-09-03", -400, "SAHKO OY"], ["2026-09-04", -250, "VESI OY"]];
    const w = await world(one(rows, 0, { extra: share }));
    expect(await month(w, w.aino, "2026-09")).toMatchObject({ paidIn: [90000, 0, 0], costs: [65000, 0, 0], moved: [0, 0, 0], left: [25000, 0, 0] });
    const paid = await world(one([fromVille("2026-09-01", 100), ...rows], 0, { extra: share }));
    expect(await month(paid, paid.ville, "2026-09")).toMatchObject({ paidIn: [90000, 10000, 0], costs: [58500, 6500, 0], left: [31500, 3500, 0] });
  });

  it("S19: one member's own credit paid from the pool is money out for him, his lots first and the rest passed; a loan in both names stays shared", async () => {
    const rows: R[] = [fromAino("2026-09-01", 1000), fromVille("2026-09-01", 200), ["2026-09-05", -350, "JOUSTOLUOTTO", IBAN.card]];
    const w = await world(one(rows, 0, { extra: withCredit }));
    expect(await month(w, w.aino, "2026-09")).toMatchObject({ costs: [0, 0, 0], moved: [15000, 20000, 0], taken: [0, 15000, 0], left: [85000, 0, 0] });
    const both = async (x: World) => {
      await link(x, x.aino, "loan-a", "MEIKALAINEN AINO, LAHTINEN VILLE", IBAN.loan, "idn-loan", "loan");
      await link(x, x.ville, "loan-v", "MEIKALAINEN AINO, LAHTINEN VILLE", IBAN.loan, "idn-loan", "loan");
      await share(x);
    };
    const shared = await world(one([fromAino("2026-09-01", 1000), fromVille("2026-09-01", 200), ["2026-09-05", -350, "ASUNTOLAINA", IBAN.loan]], 0, { extra: both }));
    expect(await month(shared, shared.aino, "2026-09")).toMatchObject({ moved: [29167, 5833, 0], taken: [0, 0, 0], left: [70833, 14167, 0] });
  });

  it("a credit paid on 31.8. while the pool was empty is what he took of her money, when her money comes on 1.9.", async () => {
    const w = await world(one([["2026-08-31", -350, "JOUSTOLUOTTO", IBAN.card], fromAino("2026-09-01", 1000)], 0, { extra: withCredit }));
    expect(await month(w, w.aino, "2026-08")).toMatchObject({ moved: [35000, 0, 0], taken: [0, 35000, 0], left: [-35000, 0, 0] });
    // near miss: her money on 30.8.
    const early = await world(one([fromAino("2026-08-30", 1000), ["2026-08-31", -350, "JOUSTOLUOTTO", IBAN.card]], 0, { extra: withCredit }));
    expect(await month(early, early.aino, "2026-08")).toMatchObject({ moved: [35000, 0, 0], taken: [0, 35000, 0], left: [65000, 0, 0] });
  });

  it("a refund of a row for one person comes off what it was counted in, not off Menot; one of a shared bill still does", async () => {
    const base: R[] = [fromAino("2026-09-01", 1000), ["2026-09-04", -80, "VISA", IBAN.card], ["2026-09-05", -600, "ASUNTO OY ESIMERKKI"]];
    // near miss: no refund
    const plain = await world(one(base, 0, { extra: withCredit }));
    expect(await month(plain, plain.aino, "2026-09")).toMatchObject({ costs: [60000, 0, 0], moved: [8000, 0, 0], taken: [0, 8000, 0], left: [32000, 0, 0] });
    const same = await world(one([...base, ["2026-09-20", 80, "VISA"]], 0, { extra: withCredit }));
    expect(await month(same, same.aino, "2026-09")).toMatchObject({ costs: [60000, 0, 0], moved: [0, 0, 0], taken: [0, 0, 0], left: [40000, 0, 0] });
    // booked the month after: September keeps its figures, October takes them back
    const later = await world(one([...base, ["2026-10-02", 80, "VISA"]], 0, { extra: withCredit }));
    expect(await month(later, later.aino, "2026-09")).toMatchObject({ costs: [60000, 0, 0], moved: [8000, 0, 0], taken: [0, 8000, 0] });
    expect(await month(later, later.aino, "2026-10")).toMatchObject({ costs: [0, 0, 0], moved: [-8000, 0, 0], taken: [0, -8000, 0], left: [40000, 0, 0] });
    // near miss: 100,00 back from the shared bill's payee comes off Menot
    const shared = await world(one([...base, ["2026-09-20", 100, "ASUNTO OY ESIMERKKI"]], 0, { extra: withCredit }));
    expect(await month(shared, shared.aino, "2026-09")).toMatchObject({ costs: [50000, 0, 0], moved: [8000, 0, 0], taken: [0, 8000, 0] });
  });

  it("money back from a payee the pool paid only in rows for one person is that row's: the card company's 80,00; near miss: also paid a shared bill, it is money back by the mix", async () => {
    const rows: R[] = [fromAino("2026-09-01", 1000), ["2026-09-04", -80, "VISA", IBAN.card], ["2026-09-06", -50, "VISA"], ["2026-09-20", 80, "VISA"]];
    const w = await world(one(rows, 0, { extra: withCredit }));
    expect(await month(w, w.aino, "2026-09")).toMatchObject({ costs: [-3000, 0, 0], moved: [8000, 0, 0], taken: [0, 8000, 0], left: [95000, 0, 0] });
  });

  describe("money back from a payee of the same name that two persons paid from their own card accounts", () => {
    const OWN_CARD = "FI8000000000000008";
    const bothCards = async (w: World) => {
      await link(w, w.aino, "aino-credit", "MEIKALAINEN AINO", OWN_CARD, "idn-aino-credit", "credit_card");
      await withCredit(w);
    };
    const fromVilleCard: R = ["2026-09-04", -80, "KORTTIYHTIO", IBAN.card];
    const fromAinoCard: R = ["2026-09-06", -50, "KORTTIYHTIO", OWN_CARD];
    const bill: R = ["2026-09-07", -600, "ASUNTO OY ESIMERKKI"];
    const back: R = ["2026-09-20", 50, "KORTTIYHTIO"];
    /** The month's columns add up to the booked rows, and the last Saldo columns to the account's balance. */
    const addUp = async (w: World, rows: R[], at: string) => {
      const m = await month(w, w.aino, at);
      const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
      expect(sum(m.paidIn) - sum(m.costs) - sum(m.moved)).toBe(cents(rows));
      expect(sum(m.left)).toBe(cents(rows));
      return m;
    };

    it("is money back by the mix when the earlier rows were for different persons; near miss: only one person's rows, it is hers", async () => {
      const rows: R[] = [fromAino("2026-09-01", 1000), fromVilleCard, fromAinoCard, bill, back];
      const w = await world(one(rows, 0, { extra: bothCards }));
      expect(await addUp(w, rows, "2026-09")).toMatchObject({ paidIn: [100000, 0, 0], costs: [55000, 0, 0], moved: [13000, 0, 0], taken: [0, 8000, 0], left: [32000, 0, 0] });
      const own = [fromAino("2026-09-01", 1000), fromAinoCard, bill, back];
      const alone = await world(one(own, 0, { extra: bothCards }));
      expect(await addUp(alone, own, "2026-09")).toMatchObject({ paidIn: [100000, 0, 0], costs: [60000, 0, 0], moved: [0, 0, 0], taken: [0, 0, 0], left: [40000, 0, 0] });
    });

    it("near miss: two rows for one person, both for the other, are his: the money back is paired to the latest", async () => {
      const rows: R[] = [fromAino("2026-09-01", 1000), fromVilleCard, ["2026-09-05", -30, "KORTTIYHTIO", IBAN.card], bill, ["2026-09-20", 30, "KORTTIYHTIO"]];
      const w = await world(one(rows, 0, { extra: bothCards }));
      expect(await addUp(w, rows, "2026-09")).toMatchObject({ paidIn: [100000, 0, 0], costs: [60000, 0, 0], moved: [8000, 0, 0], taken: [0, 8000, 0], left: [32000, 0, 0] });
    });
  });

  it("an answer moves the cents of unknown money to the person in every month, and the row sums stay", async () => {
    const rows: R[] = [["2026-08-01", 2500, "ESIMERKKI OY", "FI7700000000000007"], fromAino("2026-08-02", 200), ["2026-09-05", -190, "KAUPPA OY"]];
    const w = await world(one(rows, 0, { extra: share }));
    const before = await month(w, w.aino, "2026-09");
    expect(before).toMatchObject({ costs: [1407, 0, 17593], left: [18593, 0, 232407] });
    const said = await w.as(w.aino).call("PUT", "/api/accounts/pool-a/answers", { kind: "in", key: "g:iban:FI7700000000000007", owner: `u:${w.ville}` });
    expect(said.body).toEqual({ ok: true });
    const after = await month(w, w.ville, "2026-09");
    expect(after).toMatchObject({ costs: [1407, 17593, 0], left: [18593, 232407, 0] });
    expect(await month(w, w.ville, "2026-08")).toMatchObject({ paidIn: [20000, 250000, 0], left: [20000, 250000, 0] });
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    expect([sum(after.costs), sum(after.left)]).toEqual([sum(before.costs), sum(before.left)]);
  });
});

describe("a joint account whose other holder has no login", () => {
  const PAYER = "FI7700000000000007";
  const rows: R[] = [fromAino("2026-09-01", 1000), ["2026-09-02", 2500, "ESIMERKKI OY", PAYER], ["2026-09-05", -600, "ASUNTO OY ESIMERKKI"]];
  const pool = () => world(one(rows, 0, { holder: "MEIKALAINEN AINO, VIRTANEN MATTI" }));
  type Cols = (Column & { holder?: true })[];
  const september = async (w: World): Promise<Cols> => {
    const res = await w.as(w.aino).call("GET", "/api/accounts/pool-a/sources");
    expect(res.status).toBe(200);
    return (res.body.months as { month: string; columns: Cols }[]).find((m) => m.month === "2026-09")!.columns;
  };
  const answer = (w: World, owner: string) => w.as(w.aino).call("PUT", "/api/accounts/pool-a/answers", { kind: "in", key: `g:iban:${PAYER}`, owner });
  const figures = (c: Column) => [c.paidInCents, c.costsCents, c.leftCents];

  it("has a column of its own, marked, between the member and the rest, and the unknown 2 500,00 stays unknown", async () => {
    const w = await pool();
    const cols = await september(w);
    expect(cols.map((c) => [c.userId, c.holder])).toEqual([[w.aino, undefined], [null, true], [null, undefined]]);
    expect(cols.map(figures)).toEqual([[100000, 17143, 82857], [0, 0, 0], [250000, 42857, 207143]]);
  });

  it("an answer naming the holder moves the 2 500,00 out of Ei tiedossa into the holder's column, and the sums stay", async () => {
    const w = await pool();
    const before = await september(w);
    expect((await answer(w, "u:")).status).toBe(200);
    const after = await september(w);
    expect(after.map(figures)).toEqual([[100000, 17143, 82857], [250000, 42857, 207143], [0, 0, 0]]);
    for (const f of ["paidInCents", "costsCents", "movedCents", "takenCents", "leftCents"] as const) expect(after.reduce((a, c) => a + c[f], 0), f).toBe(before.reduce((a, c) => a + c[f], 0));
  });

  it("near miss: an answer naming the member empties Ei tiedossa into the member's column, and the holder's stays empty", async () => {
    const w = await pool();
    expect((await answer(w, `u:${w.aino}`)).status).toBe(200);
    expect((await september(w)).map(figures)).toEqual([[350000, 60000, 290000], [0, 0, 0], [0, 0, 0]]);
  });

  it("near miss: a member's own account has no holder's column, and the flag is on no other", async () => {
    const w = await world(one(rows, 0, { extra: share }));
    const res = await w.as(w.aino).call("GET", "/api/accounts/pool-a/sources");
    expect(JSON.stringify(res.body)).not.toContain("holder");
  });

  it("leaks no IBAN and no holder's name", async () => {
    const w = await pool();
    await answer(w, "u:");
    const text = JSON.stringify((await w.as(w.aino).call("GET", "/api/accounts/pool-a/sources")).body);
    for (const secret of [PAYER, "VIRTANEN", "MATTI", "MEIKALAINEN", IBAN.pool, IBAN.aino]) expect(text).not.toContain(secret);
  });
});

describe("who may ask", () => {
  const rows: R[] = [fromAino("2026-09-01", 1000), ["2026-09-03", -300, "SAHKO OY"]];

  it("answers 404 to a member the account is not shared with and to an account that is not there, and no months for an account not traced", async () => {
    const w = await world(one(rows, 0, { extra: share }));
    const third = await w.member("cecilia", "Cecilia");
    expect((await third.call("GET", "/api/accounts/pool-a/sources")).status).toBe(404);
    const own = await w.as(w.aino).call("GET", "/api/accounts/aino-own/sources");
    expect([own.status, own.body]).toEqual([200, { months: [] }]);
    // another member's account, not shared, is as missing as one that is not there
    expect((await third.call("GET", "/api/accounts/aino-own/sources")).status).toBe(404);
    expect((await w.as(w.aino).call("GET", "/api/accounts/no-such/sources")).status).toBe(404);
    // near miss: the member it is shared with, and the member who linked it, are let in
    expect((await w.as(w.ville).call("GET", "/api/accounts/pool-a/sources")).status).toBe(200);
    expect((await w.as(w.aino).call("GET", "/api/accounts/pool-a/sources")).status).toBe(200);
    // it needs a sign-in
    expect((await w.client().call("GET", "/api/accounts/pool-a/sources")).status).toBe(401);
  });

  it("leaks no IBAN and no holder's name, only member ids", async () => {
    const w = await world(one(rows, 0, { extra: share }));
    const text = JSON.stringify((await w.as(w.ville).call("GET", "/api/accounts/pool-a/sources")).body);
    for (const secret of [IBAN.pool, IBAN.aino, IBAN.ville, "AINO", "VILLE", "SAHKO"]) expect(text).not.toContain(secret);
    expect(text).toContain(w.aino);
  });
});
