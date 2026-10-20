/**
 * Rows in another currency are kept apart from the euro rows, in the bank's own figure, and no euro figure moves
 * because of them. Made-up sums and names.
 */
import { describe, expect, it } from "vitest";
import { syncUser } from "../src/connectors/sync.ts";
import { accountKey } from "../src/db/household-repo.ts";
import { foreignDaysOf, foreignRowsView } from "../src/services/foreign-rows.ts";
import { connectedFeed, ebRow } from "./feed-bank.ts";

/** A row as the bank sends it, its amount in `currency`. */
const inCurrency = (currency: string, ref: string | null, date: string, amount: string, dir: "CRDT" | "DBIT", name: string, status = "BOOK") => {
  const { entry_reference, ...row } = ebRow(ref ?? "x", date, amount, dir, name, status);
  return { ...(ref === null ? {} : { entry_reference }), ...row, transaction_amount: { currency, amount } };
};

async function kept(f: Awaited<ReturnType<typeof connectedFeed>>) {
  return (await f.repo.foreignRowsOf([accountKey(f.chk)])).map((r) => `${r.bookingDate} ${r.currency} ${r.amountMinor}/${r.scale}`).sort();
}

describe("rows in another currency, a fetch", () => {
  it("keeps three dollar rows apart: money in, money out and a refund; every euro figure is as without them", async () => {
    const f = await connectedFeed();
    f.feed.rows = [ebRow("a", "2026-10-04", "12.00", "DBIT", "KAUPPA A")];
    await syncUser(f.s, f.adminId, "manual");
    const before = (await f.admin.call("GET", "/api/dashboard")).body;
    const beforeReports = (await f.admin.call("GET", "/api/reports")).body;

    f.feed.rows.push(
      inCurrency("USD", "u1", "2026-10-03", "100.00", "CRDT", "ESIMERKKI OY"),
      inCurrency("USD", "u2", "2026-10-05", "30.00", "DBIT", "AMAZON TEST"),
      inCurrency("USD", "u3", "2026-10-09", "30.00", "CRDT", "AMAZON TEST"),
    );
    const r = await syncUser(f.s, f.adminId, "manual");
    expect(r.messages).toEqual([]);
    expect(await kept(f)).toEqual(["2026-10-03 USD 10000/2", "2026-10-05 USD -3000/2", "2026-10-09 USD 3000/2"]);
    expect(await f.stored()).toEqual(["2026-10-04 booked -1200 Kauppa A"]);
    // no euro figure moved: the first page and the reports are the same answers
    expect((await f.admin.call("GET", "/api/dashboard")).body).toEqual(before);
    expect((await f.admin.call("GET", "/api/reports")).body).toEqual(beforeReports);

    // the same fetch again: nothing new, no row doubled
    expect((await syncUser(f.s, f.adminId, "manual")).messages).toEqual([]);
    expect(await kept(f)).toHaveLength(3);
    const view = await foreignRowsView(f.s, f.adminId, await f.repo.listAccounts());
    expect(view[f.chk.id]).toEqual([
      {
        currency: "USD",
        count: 3,
        totalMinor: 10000,
        scale: 2,
        rows: [
          { day: "2026-10-09", amountMinor: 3000, scale: 2, text: "AMAZON TEST KORTTIOSTO" },
          { day: "2026-10-05", amountMinor: -3000, scale: 2, text: "AMAZON TEST KORTTIOSTO" },
          { day: "2026-10-03", amountMinor: 10000, scale: 2, text: "ESIMERKKI OY KORTTIOSTO" },
        ],
      },
    ]);
  });

  it("a second fetch with nothing new does not move the data version, a new row does", async () => {
    const f = await connectedFeed();
    f.feed.rows = [inCurrency("USD", "u1", "2026-10-03", "20.00", "DBIT", "AMAZON TEST")];
    await syncUser(f.s, f.adminId, "manual");
    const version = await f.s.settings.dataVersionOf([f.adminId]);
    await syncUser(f.s, f.adminId, "manual");
    expect(await f.s.settings.dataVersionOf([f.adminId])).toBe(version);
    f.feed.rows.push(inCurrency("USD", "u2", "2026-10-04", "5.00", "CRDT", "ESIMERKKI OY"));
    await syncUser(f.s, f.adminId, "manual");
    expect(await f.s.settings.dataVersionOf([f.adminId])).not.toBe(version);
  });

  it("reads the scale as sent: JPY with none, KWD with three, and a euro row with three decimals stays a euro row", async () => {
    const f = await connectedFeed();
    f.feed.rows = [
      inCurrency("JPY", "j", "2026-10-01", "1500", "DBIT", "ESIMERKKI KK"),
      inCurrency("KWD", "k", "2026-10-02", "1.234", "DBIT", "ESIMERKKI KWT"),
      ebRow("e", "2026-10-03", "12.345", "DBIT", "KAUPPA A"),
    ];
    await syncUser(f.s, f.adminId, "manual");
    expect(await kept(f)).toEqual(["2026-10-01 JPY -1500/0", "2026-10-02 KWD -1234/3"]);
    expect(await f.stored()).toHaveLength(1);
  });

  it("takes the currency of the row itself: ' usd' is dollars, ' eur ' is euros, 'EURO' and none are unknown (XXX)", async () => {
    const f = await connectedFeed();
    f.feed.rows = [
      inCurrency(" usd", "a", "2026-10-01", "1.00", "DBIT", "A"),
      inCurrency(" eur ", "b", "2026-10-02", "2.00", "DBIT", "B"),
      inCurrency("EURO", "c", "2026-10-03", "3.00", "DBIT", "C"),
      inCurrency("", "d", "2026-10-04", "4.00", "DBIT", "D"),
    ];
    await syncUser(f.s, f.adminId, "manual");
    expect(await kept(f)).toEqual(["2026-10-01 USD -100/2", "2026-10-03 XXX -300/2", "2026-10-04 XXX -400/2"]);
    expect(await f.stored()).toEqual(["2026-10-02 booked -200 B"]);
  });

  it("a card purchase booked in euros with its original currency beside it is one euro row, and the original is not read", async () => {
    const f = await connectedFeed();
    f.feed.rows = [{ ...ebRow("a", "2026-10-02", "18.40", "DBIT", "ESIMERKKI INC"), exchange_rate: { instructed_amount: { currency: "USD", amount: "20.00" } }, remittance_information: ["USD 20.00"] }];
    await syncUser(f.s, f.adminId, "manual");
    expect(await f.stored()).toEqual(["2026-10-02 booked -1840 Esimerkki"]);
    expect(await kept(f)).toEqual([]);
  });

  it("two equal rows with no bank id stay two rows, and a second fetch does not double them", async () => {
    const f = await connectedFeed();
    f.feed.rows = [inCurrency("USD", null, "2026-10-02", "4.50", "DBIT", "KAHVILA TEST"), inCurrency("USD", null, "2026-10-02", "4.50", "DBIT", "KAHVILA TEST")];
    await syncUser(f.s, f.adminId, "manual");
    await syncUser(f.s, f.adminId, "manual");
    expect(await kept(f)).toEqual(["2026-10-02 USD -450/2", "2026-10-02 USD -450/2"]);
  });

  it("a row the bank corrects (same id, another amount) is changed in place", async () => {
    const f = await connectedFeed();
    f.feed.rows = [inCurrency("USD", "u1", "2026-10-02", "4.50", "DBIT", "KAHVILA TEST")];
    await syncUser(f.s, f.adminId, "manual");
    f.feed.rows = [inCurrency("USD", "u1", "2026-10-02", "5.50", "DBIT", "KAHVILA TEST")];
    await syncUser(f.s, f.adminId, "manual");
    expect(await kept(f)).toEqual(["2026-10-02 USD -550/2"]);
  });

  it("a refund days later is another row on its own day: no netting, the newest day moves to it", async () => {
    const f = await connectedFeed();
    f.feed.rows = [inCurrency("USD", "u1", "2026-10-02", "30.00", "DBIT", "AMAZON TEST")];
    await syncUser(f.s, f.adminId, "manual");
    expect(await foreignDaysOf(f.s, f.adminId, [f.chk])).toEqual([{ accountId: f.chk.id, count: 1, newestDay: "2026-10-02" }]);
    f.feed.rows.push(inCurrency("USD", "u2", "2026-10-05", "30.00", "CRDT", "AMAZON TEST"));
    await syncUser(f.s, f.adminId, "manual");
    expect(await kept(f)).toEqual(["2026-10-02 USD -3000/2", "2026-10-05 USD 3000/2"]);
    expect(await foreignDaysOf(f.s, f.adminId, [f.chk])).toEqual([{ accountId: f.chk.id, count: 2, newestDay: "2026-10-05" }]);
  });

  it("a row whose amount is not a plain decimal is not kept and is counted in the note; a pending row too", async () => {
    const f = await connectedFeed();
    f.feed.rows = [inCurrency("USD", "u1", "2026-10-02", "1.2345", "DBIT", "A"), inCurrency("USD", "u2", "2026-10-03", "2.00", "DBIT", "B", "PDNG"), inCurrency("USD", "u3", "2026-10-04", "3.00", "DBIT", "C")];
    const r = await syncUser(f.s, f.adminId, "manual");
    expect(r.messages).toEqual(["Käyttötili: ohitettu 2 riviä, joiden valuutta ei ole EUR (USD)."]);
    expect(await kept(f)).toEqual(["2026-10-04 USD -300/2"]);
  });
});

describe("rows in another currency, the day walk", () => {
  it("the context carries the newest foreign day of each account in view", async () => {
    const f = await connectedFeed();
    f.feed.rows = [ebRow("a", "2026-10-01", "10.00", "DBIT", "KAUPPA A"), inCurrency("USD", "u1", "2026-10-03", "20.00", "DBIT", "AMAZON TEST")];
    await syncUser(f.s, f.adminId, "manual");
    const { ctx } = await f.s.analysis.get(f.s, f.adminId, "own");
    expect(ctx.foreignRows).toEqual([{ accountId: f.chk.id, count: 1, newestDay: "2026-10-03" }]);
  });
});

describe("rows in another currency, kept by the real account", () => {
  it("a key held by two copies of an account is one set of rows: a re-read changes nothing", async () => {
    const f = await connectedFeed();
    const row = { rawKey: "r1", bookingDate: "2026-10-02", amountMinor: -2000, scale: 2, currency: "USD", text: "ESIMERKKI INC" };
    expect(await f.repo.storeForeignRows("idn-test", [row], "2026-10-10T08:00:00.000Z")).toBe(1);
    expect(await f.repo.storeForeignRows("idn-test", [row], "2026-10-10T09:00:00.000Z")).toBe(0);
    expect(await f.repo.storeForeignRows("idn-test", [{ ...row, amountMinor: -2500 }], "2026-10-10T10:00:00.000Z")).toBe(1);
    expect(await f.repo.foreignRowsOf(["idn-test"])).toHaveLength(1);
  });

  it("the start-up sweep and the removal of an account leave the rows", async () => {
    const f = await connectedFeed();
    await f.repo.storeForeignRows("idn-gone", [{ rawKey: "r1", bookingDate: "2026-10-02", amountMinor: -2000, scale: 2, currency: "USD", text: null }], "2026-10-10T08:00:00.000Z");
    await f.s.household.sweepUnheldKeys();
    expect(await f.repo.foreignRowsOf(["idn-gone"])).toHaveLength(1);
  });
});
