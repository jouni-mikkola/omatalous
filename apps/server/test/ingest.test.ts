/**
 * Fetch and import robustness: overlapping windows, pending rows that get booked, identical purchases,
 * a CSV over fetched data, signs and dates, and a fetch that fails halfway.
 */
import { addDays, type RawTransaction } from "@banking/core";
import { describe, expect, it } from "vitest";
import { mapTransaction } from "../src/connectors/enable-banking/mapper.ts";
import { syncUser } from "../src/connectors/sync.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { reprocess } from "../src/services/enrich.ts";
import { accountKey } from "../src/db/household-repo.ts";
import { setupApp } from "./helpers.ts";
import { connectedFeed, ebRow } from "./feed-bank.ts";

const raw = (bookingDate: string, euros: number, counterparty: string | null, extra: Partial<RawTransaction> = {}): RawTransaction => ({
  externalId: null,
  bookingDate,
  valueDate: null,
  amountCents: Math.round(euros * 100),
  currency: "EUR",
  status: "booked",
  counterparty,
  counterpartyIban: null,
  description: null,
  reference: null,
  mcc: null,
  ...extra,
});

async function withAccount() {
  const t = await setupApp();
  const repo = t.s.finance(t.adminId);
  await repo.upsertAccount({ id: "chk", connectionId: null, provider: "enablebanking", externalId: "u", identity: null, name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" });
  const rows = async () => (await repo.transactionsOfAccount("chk")).map((r) => `${r.bookingDate} ${r.status} ${r.amountCents} ${r.merchant} ${r.source}`);
  const fetchBank = (rawRows: RawTransaction[]) => ingestTransactions(repo, "chk", rawRows, "enablebanking");
  const importCsv = (rawRows: RawTransaction[]) => ingestTransactions(repo, "chk", rawRows, "csv");
  return { ...t, repo, rows, fetchBank, importCsv };
}

describe("overlapping fetch windows", () => {
  it.each([
    ["with the bank's ids", (n: number) => ({ externalId: `ref-${n}` })],
    ["without ids", () => ({})],
  ])("do not duplicate rows, %s", async (_name, ids) => {
    const { fetchBank, rows } = await withAccount();
    const a = raw("2026-10-01", -12, "KAHVILA A", { ...ids(1) });
    const b = raw("2026-10-03", -30, "KAUPPA B", { ...ids(2) });
    const c = raw("2026-10-05", -8, "KIOSKI C", { ...ids(3) });
    expect(await fetchBank([a, b])).toMatchObject({ inserted: 2 });
    expect(await fetchBank([b, c])).toMatchObject({ inserted: 1, updated: 1 });
    expect(await fetchBank([a, b, c])).toMatchObject({ inserted: 0, updated: 3 });
    expect(await rows()).toHaveLength(3);
  });

  it("two identical purchases on one day stay two rows, through overlaps and when the second arrives later", async () => {
    const { fetchBank, rows } = await withAccount();
    const coffee = () => raw("2026-10-06", -3.5, "ESPRESSO HOUSE", { description: "KORTTIOSTO" });
    await fetchBank([coffee()]);
    expect(await rows()).toHaveLength(1);
    await fetchBank([coffee(), coffee()]);
    expect(await rows()).toHaveLength(2);
    await fetchBank([coffee(), coffee(), raw("2026-10-07", -5, "KIOSKI")]);
    await fetchBank([coffee(), coffee()]);
    expect((await rows()).filter((r) => r.includes("Espresso"))).toHaveLength(2);
  });

  it("rows with the same bank id on one day are all kept", async () => {
    const { fetchBank, rows } = await withAccount();
    const same = () => [raw("2026-10-06", -3.5, "ESPRESSO HOUSE", { externalId: "dup" }), raw("2026-10-06", -3.5, "ESPRESSO HOUSE", { externalId: "dup" })];
    await fetchBank(same());
    await fetchBank(same());
    expect(await rows()).toHaveLength(2);
  });
});

describe("a pending row that gets booked", () => {
  const pending = (date = "2026-10-08", extra: Partial<RawTransaction> = {}) => raw(date, -8.5, "ESPRESSO HOUSE", { status: "pending", description: "KORTTIOSTO", ...extra });

  it("is replaced by the booked row, which has another id, text and date, and keeps the user's category", async () => {
    const { fetchBank, rows, repo } = await withAccount();
    await fetchBank([pending()]);
    const [p] = await repo.transactionsOfAccount("chk");
    await repo.setUserCategory(p!.id, "groceries");
    await fetchBank([raw("2026-10-09", -8.5, "ESPRESSO HOUSE HELSINKI", { externalId: "new-id", description: "Korttiosto 12.10" })]);
    expect(await rows()).toEqual(["2026-10-09 booked -850 Espresso House enablebanking"]);
    expect((await repo.transactionsOfAccount("chk"))[0]).toMatchObject({ category: "groceries", categorySource: "user" });
  });

  it("is not kept next to its booked row when the bank lists both", async () => {
    const { fetchBank, rows } = await withAccount();
    await fetchBank([pending("2026-10-08"), raw("2026-10-09", -8.5, "ESPRESSO HOUSE", { externalId: "b1", description: "KORTTIOSTO" })]);
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]).toContain("booked");
  });
});

describe("a CSV over fetched data", () => {
  it("skips a row the bank already gave and keeps a different purchase of the same amount on the same day", async () => {
    const { fetchBank, importCsv, rows } = await withAccount();
    await fetchBank([raw("2026-10-06", -3.5, "ESPRESSO HOUSE", { externalId: "e1", description: "KORTTIOSTO" })]);
    const r = await importCsv([raw("2026-10-06", -3.5, "KAHVILA TUOMAS", { description: "KORTTIOSTO" }), raw("2026-10-06", -3.5, "ESPRESSO HOUSE", { description: "KORTTIOSTO" })]);
    expect(r).toMatchObject({ inserted: 1, skipped: 1 });
    expect((await rows()).sort()).toEqual(["2026-10-06 booked -350 Espresso House enablebanking", "2026-10-06 booked -350 Kahvila Tuomas csv"]);
  });

  it("keeps the second of two identical purchases when the bank has only one, and skips both when it has two", async () => {
    const { fetchBank, importCsv, rows } = await withAccount();
    const coffee = () => raw("2026-10-06", -3.5, "ESPRESSO HOUSE", { description: "KORTTIOSTO" });
    await fetchBank([{ ...coffee(), externalId: "e1" }]);
    expect(await importCsv([coffee(), coffee()])).toMatchObject({ inserted: 1, skipped: 1 });
    expect(await rows()).toHaveLength(2);
    expect(await importCsv([coffee(), coffee()])).toMatchObject({ inserted: 0 });
    expect(await rows()).toHaveLength(2);
    await fetchBank([{ ...coffee(), externalId: "e1" }, { ...coffee(), externalId: "e2" }]);
    expect(await rows()).toHaveLength(2);
  });

  it("matches the same payment when the texts differ a little", async () => {
    const { fetchBank, importCsv } = await withAccount();
    await fetchBank([raw("2026-10-06", -54.2, "IF VAHINKOVAKUUTUS OY", { externalId: "i1", description: "Kotivakuutus 10/2026" })]);
    expect(await importCsv([raw("2026-10-06", -54.2, "IF VAHINKOVAKUUTUS OY", { description: "E-LASKU KOTIVAKUUTUS" })])).toMatchObject({ inserted: 0, skipped: 1 });
  });
});

describe("two layouts of the same purchases from one source", () => {
  // an export and an older layout of it write the same purchases with other columns, so the row ids differ
  const current = [
    raw("2026-09-30", -23.45, null, { description: "K-MARKET KAMPPI" }),
    raw("2026-09-29", -12.9, null, { description: "SPOTIFY" }),
    raw("2026-09-29", -3.5, null, { description: "ESPRESSO HOUSE" }),
    raw("2026-09-29", -3.5, null, { description: "ESPRESSO HOUSE" }),
  ];
  const olderRow = (date: string, euros: number, name: string) => raw(date, euros, name, { description: "Korttiosto" });
  const olderFile = (...more: RawTransaction[]) => [
    olderRow("2026-09-30", -23.45, "K-MARKET KAMPPI"),
    olderRow("2026-09-29", -12.9, "SPOTIFY"),
    olderRow("2026-09-29", -3.5, "ESPRESSO HOUSE"),
    olderRow("2026-09-29", -3.5, "ESPRESSO HOUSE"),
    ...more,
  ];
  const older = olderFile();

  it("store each purchase once, identical purchases included", async () => {
    const { importCsv, rows } = await withAccount();
    expect(await importCsv(current)).toMatchObject({ inserted: 4 });
    expect(await importCsv(older)).toMatchObject({ inserted: 0, skipped: 4 });
    expect(await rows()).toHaveLength(4);
    // the same files again are the same rows, not twins
    expect(await importCsv(older)).toMatchObject({ inserted: 0, skipped: 4 });
    expect(await importCsv(current)).toMatchObject({ inserted: 0, updated: 4 });
    expect(await rows()).toHaveLength(4);
  });

  it("keeps what only the second layout has, and a third identical purchase", async () => {
    const { importCsv, rows } = await withAccount();
    await importCsv(current);
    const more = olderFile(olderRow("2026-09-28", -9.9, "NETFLIX"), olderRow("2026-09-29", -3.5, "ESPRESSO HOUSE"));
    expect(await importCsv(more)).toMatchObject({ inserted: 2, skipped: 4 });
    expect(await rows()).toHaveLength(6);
  });

  it("does not take a bank's own rows with different ids for twins of each other", async () => {
    const { fetchBank, rows } = await withAccount();
    await fetchBank([raw("2026-10-06", -3.5, "ESPRESSO HOUSE", { externalId: "e1", description: "KORTTIOSTO" })]);
    await fetchBank([raw("2026-10-06", -3.5, "ESPRESSO HOUSE", { externalId: "e2", description: "KORTTIOSTO" })]);
    expect(await rows()).toHaveLength(2);
  });
});

describe("amounts and dates", () => {
  const eb = (amount: string, indicator: "CRDT" | "DBIT" | undefined, dates: Record<string, string> = { booking_date: "2026-10-08" }) =>
    mapTransaction({ transaction_amount: { currency: "EUR", amount }, credit_debit_indicator: indicator as "CRDT", status: "BOOK", ...dates });

  it("money out is negative and money in positive, whatever the sign the bank writes", () => {
    expect(eb("12.50", "DBIT")!.amountCents).toBe(-1250);
    expect(eb("-12.50", "DBIT")!.amountCents).toBe(-1250);
    expect(eb("12.50", "CRDT")!.amountCents).toBe(1250);
    expect(eb("-12.50", undefined)!.amountCents).toBe(-1250);
    expect(eb("12.50", undefined)!.amountCents).toBe(1250);
    expect(eb("0.29", "DBIT")!.amountCents).toBe(-29);
    expect(eb("1234567.89", "CRDT")!.amountCents).toBe(123456789);
  });

  it("a date with a time is read in the household's time zone", () => {
    expect(eb("1", "DBIT", { booking_date: "2026-10-08" })!.bookingDate).toBe("2026-10-08");
    expect(eb("1", "DBIT", { booking_date: "2026-10-08T00:00:00" })!.bookingDate).toBe("2026-10-08");
    // 22:30 UTC on 8 October is 01:30 on the 9th in Helsinki (summer time ends on 25 October)
    expect(eb("1", "DBIT", { booking_date: "2026-10-08T22:30:00Z" })!.bookingDate).toBe("2026-10-09");
    expect(eb("1", "DBIT", { booking_date: "2026-10-08T22:30:00+00:00" })!.bookingDate).toBe("2026-10-09");
    expect(eb("1", "DBIT", { booking_date: "2026-10-08T22:30:00Z" })!.bookingDate).toBe("2026-10-09");
    expect(eb("1", "DBIT", { transaction_date: "2026-10-08T10:00:00+03:00" })!.bookingDate).toBe("2026-10-08");
    expect(eb("1", "DBIT", { booking_date: "garbage", value_date: "2026-10-07" })!.bookingDate).toBe("2026-10-07");
    expect(eb("1", "DBIT", { booking_date: "not a date" })).toBeNull();
  });
});

describe("a fetch that fails or is cut short", () => {
  it("leaves the earlier rows, including pending ones, and the next fetch brings what was missed", async () => {
    const f = await connectedFeed();
    f.feed.rows = [ebRow("a", "2026-10-01", "10.00", "DBIT", "KAUPPA A"), ebRow("p", "2026-10-08", "8.50", "DBIT", "KAHVILA", "PDNG")];
    expect((await syncUser(f.s, f.adminId, "manual")).status).toBe("ok");
    const before = await f.stored();
    expect(before).toHaveLength(2);

    // the bank has two more rows and the second page fails
    f.feed.pageSize = 1;
    f.feed.rows.push(ebRow("b", "2026-10-05", "20.00", "DBIT", "KAUPPA B"), ebRow("c", "2026-10-07", "30.00", "DBIT", "KAUPPA C"));
    f.feed.failAtPage = 2;
    const failed = await syncUser(f.s, f.adminId, "manual");
    // the card account was fetched, the checking account was not
    expect(failed.status).toBe("partial");
    expect(failed.messages.join(" ")).toContain("500");
    expect(await f.stored()).toEqual(before);

    f.feed.failAtPage = 0;
    expect((await syncUser(f.s, f.adminId, "manual")).status).toBe("ok");
    expect(await f.stored()).toHaveLength(4);
    // the retry starts from the same day, not after the failed attempt
    expect(f.feed.fromDates.at(-1)).toBe(f.feed.fromDates.at(-2));
  });

  it("a page limit hit is a failed fetch, not a short one", async () => {
    const f = await connectedFeed();
    f.feed.rows = [ebRow("a", "2026-10-01", "10.00", "DBIT", "KAUPPA A")];
    await syncUser(f.s, f.adminId, "manual");
    f.feed.endless = true;
    f.feed.rows.push(ebRow("b", "2026-10-05", "20.00", "DBIT", "KAUPPA B"));
    const cut = await syncUser(f.s, f.adminId, "manual");
    expect(cut.status).toBe("partial");
    expect(await f.stored()).toHaveLength(1);
  });

  it("an overlapping fetch adds only the new rows and a pending row that got booked is not doubled", async () => {
    const f = await connectedFeed();
    f.feed.rows = [ebRow("a", "2026-10-01", "10.00", "DBIT", "KAUPPA A"), ebRow("p", "2026-10-08", "8.50", "DBIT", "ESPRESSO HOUSE", "PDNG")];
    await syncUser(f.s, f.adminId, "manual");
    f.feed.rows = [ebRow("a", "2026-10-01", "10.00", "DBIT", "KAUPPA A"), ebRow("q", "2026-10-09", "8.50", "DBIT", "ESPRESSO HOUSE"), ebRow("d", "2026-10-09", "5.00", "CRDT", "MUMMO")];
    const r = await syncUser(f.s, f.adminId, "manual");
    expect(r).toMatchObject({ status: "ok", inserted: 2 });
    expect(await f.stored()).toEqual(["2026-10-01 booked -1000 Kauppa A", "2026-10-09 booked -850 Espresso House", "2026-10-09 booked 500 Mummo"]);
    // the window starts ten days before the newest booked row
    expect(f.feed.fromDates.at(-1)).toBe("2026-09-21");
    await reprocess(f.repo, f.s.settings);
  });
});

describe("the bank code of a fetched row", () => {
  type Code = { code?: string; sub_code?: string; description?: string };
  const coded = (ref: string, date: string, euros: string, dir: "CRDT" | "DBIT", name: string, code?: Code) => ({
    ...ebRow(ref, date, euros, dir, name),
    remittance_information: ["TILISIIRTO"],
    ...(code ? { bank_transaction_code: code } : {}),
  });
  const SALARY: Code = { code: "PMNT", sub_code: "RCDT-SALA" };

  it("bank code: a fetch stores it with the row, the rules read it, and the next fetch of the same rows writes nothing", async () => {
    const f = await connectedFeed();
    f.feed.rows = [
      coded("pay", "2026-10-01", "2500.00", "CRDT", "HUS-YHTYMÄ", SALARY),
      coded("atm", "2026-10-02", "60.00", "DBIT", "K-MARKET KAMPPI", { code: "PMNT-CCRD-CWDL" }),
      coded("txt", "2026-10-03", "12.00", "DBIT", "KAUPPA A", { description: "Korttiosto" }),
      coded("non", "2026-10-04", "2500.00", "CRDT", "HUS-YHTYMÄ"),
    ];
    expect(await syncUser(f.s, f.adminId, "manual")).toMatchObject({ status: "ok", inserted: 4 });
    const read = async () => (await f.repo.allTransactions()).map((t) => `${t.bookingDate} ${t.bankTxnCode} ${t.category}`);
    const first = await read();
    // pay from an employer a merchant rule knows is pay and cash from a shop's till is cash; the same pay without a code stays the merchant's
    expect(first).toEqual(["2026-10-01 PMNT-RCDT-SALA salary", "2026-10-02 PMNT-CCRD-CWDL cash", "2026-10-03 null other", "2026-10-04 null health"]);
    const version = await f.s.settings.get(`data_version:${f.adminId}`);
    expect(await syncUser(f.s, f.adminId, "manual")).toMatchObject({ status: "ok", inserted: 0 });
    expect(await read()).toEqual(first);
    // no row was written: the user's data version did not move
    expect(await f.s.settings.get(`data_version:${f.adminId}`)).toBe(version);
  });

  it("bank code: a row stored without one is written once when the bank sends it again with its code", async () => {
    const { fetchBank, repo } = await withAccount();
    const pay = (code?: Code) => mapTransaction({ ...coded("pay", "2026-10-01", "2500.00", "CRDT", "HUS-YHTYMÄ", code), status: "BOOK" })!;
    const codes = async () => (await repo.allTransactions()).map((t) => t.bankTxnCode);
    expect(await fetchBank([pay()])).toMatchObject({ inserted: 1, changed: 1 });
    expect(await codes()).toEqual([null]);
    expect(await fetchBank([pay(SALARY)])).toMatchObject({ inserted: 0, updated: 1, changed: 1 });
    expect(await codes()).toEqual(["PMNT-RCDT-SALA"]);
    expect(await fetchBank([pay(SALARY)])).toMatchObject({ inserted: 0, updated: 1, changed: 0 });
    // a code that changes is a change of the row, like any other field of the bank's
    expect(await fetchBank([pay({ code: "PMNT", sub_code: "RCDT-ESCT" })])).toMatchObject({ changed: 1 });
    expect(await codes()).toEqual(["PMNT-RCDT-ESCT"]);
  });
});

describe("rows in another currency", () => {
  const inCurrency = (currency: string, row: ReturnType<typeof ebRow>) => ({ ...row, transaction_amount: { currency, amount: row.transaction_amount.amount } });

  it("a fetch keeps them apart from the euro rows, and says nothing of rows it kept", async () => {
    const f = await connectedFeed();
    f.feed.rows = [
      ebRow("a", "2026-10-01", "10.00", "DBIT", "KAUPPA A"),
      inCurrency("SEK", ebRow("b", "2026-10-02", "500.00", "DBIT", "ICA STOCKHOLM")),
      inCurrency("SEK", ebRow("c", "2026-10-03", "80.00", "DBIT", "SJ AB")),
      inCurrency("USD", ebRow("d", "2026-10-04", "20.00", "DBIT", "AMAZON")),
    ];
    const r = await syncUser(f.s, f.adminId, "manual");
    expect(r).toMatchObject({ status: "ok", fetched: 1, inserted: 1, messages: [] });
    expect(await f.stored()).toEqual(["2026-10-01 booked -1000 Kauppa A"]);
    expect((await f.repo.foreignRowsOf([accountKey(f.chk)])).map((x) => `${x.currency} ${x.amountMinor}/${x.scale}`).sort()).toEqual(["SEK -50000/2", "SEK -8000/2", "USD -2000/2"]);
    // the same rows on the next run: still one euro row, no message
    expect((await syncUser(f.s, f.adminId, "manual")).messages).toEqual([]);
    expect(await f.stored()).toHaveLength(1);
  });

  it("counts a pending row in another currency in the note and does not keep it", async () => {
    const f = await connectedFeed();
    f.feed.rows = [ebRow("a", "2026-10-01", "10.00", "DBIT", "KAUPPA A"), inCurrency("NOK", ebRow("b", "2026-10-02", "99.00", "DBIT", "KIWI OSLO", "PDNG"))];
    expect((await syncUser(f.s, f.adminId, "manual")).messages).toEqual(["Käyttötili: ohitettu 1 rivi, jonka valuutta ei ole EUR (NOK)."]);
    expect(await f.repo.foreignRowsOf([accountKey(f.chk)])).toEqual([]);
  });
});

describe("an account entirely in another currency", () => {
  it("is asked for the whole history once, not on every run", async () => {
    const f = await connectedFeed();
    const sek = (ref: string, date: string) => ({ ...ebRow(ref, date, "500.00", "DBIT", "ICA STOCKHOLM"), transaction_amount: { currency: "SEK", amount: "500.00" } });
    // the first fetch, when the bank was linked, asked for the longest history
    expect(f.feed.fromDates[0]).toBe(addDays(f.s.today(), -f.s.instance.current.historyDays));
    f.feed.rows = [sek("a", "2026-10-01"), sek("b", "2026-10-02")];
    for (let run = 0; run < 2; run++) {
      expect((await syncUser(f.s, f.adminId, "manual")).messages).toEqual([]);
      // no euro row is stored, so the window comes from the last fetch: ten days before it
      expect(f.feed.fromDates.at(-1)).toBe(addDays(f.s.today(), -10));
    }
    expect(await f.stored()).toEqual([]);
    expect(await f.repo.foreignRowsOf([accountKey(f.chk)])).toHaveLength(2);
  });
});
