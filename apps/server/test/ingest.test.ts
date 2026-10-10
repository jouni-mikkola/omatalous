/**
 * Fetch and import robustness: overlapping windows, pending rows that get booked, identical purchases,
 * a CSV over fetched data, signs and dates, and a fetch that fails halfway.
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import type { RawTransaction } from "@banking/core";
import { describe, expect, it } from "vitest";
import { mapTransaction } from "../src/providers/enable-banking/mapper.ts";
import { syncUser } from "../src/services/bank.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { reprocess } from "../src/services/enrich.ts";
import { setupApp, waitFor } from "./helpers.ts";
import { mockBank } from "./mock-bank.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

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
  const fetchBank = (rawRows: RawTransaction[]) => ingestTransactions(repo, "chk", rawRows, "enablebanking", { replacePending: true });
  const importCsv = (rawRows: RawTransaction[]) => ingestTransactions(repo, "chk", rawRows, "csv", { replacePending: false });
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

  it("is removed when a CSV import brings the booked row", async () => {
    const { fetchBank, importCsv, rows, repo } = await withAccount();
    await fetchBank([pending(), raw("2026-10-01", -4, "KIOSKI")]);
    const [p] = (await repo.transactionsOfAccount("chk")).filter((r) => r.status === "pending");
    await repo.setUserCategory(p!.id, "groceries");
    await importCsv([raw("2026-10-08", -8.5, "ESPRESSO HOUSE", { description: "KORTTIOSTO" })]);
    expect((await rows()).filter((r) => r.includes("-850"))).toEqual(["2026-10-08 booked -850 Espresso House csv"]);
    expect((await repo.transactionsOfAccount("chk")).find((r) => r.amountCents === -850)).toMatchObject({ category: "groceries", categorySource: "user" });
  });

  it("does not take a new pending purchase for yesterday's booked one", async () => {
    const { fetchBank, importCsv, rows } = await withAccount();
    await fetchBank([raw("2026-10-07", -8.5, "ESPRESSO HOUSE", { externalId: "b1", description: "KORTTIOSTO" }), pending("2026-10-08")]);
    expect(await rows()).toHaveLength(2);
    await importCsv([raw("2026-10-07", -8.5, "ESPRESSO HOUSE", { description: "KORTTIOSTO" })]);
    expect(await rows()).toHaveLength(2);
  });

  it("a pending row of another amount or merchant stays", async () => {
    const { fetchBank, importCsv, rows } = await withAccount();
    await fetchBank([pending(), raw("2026-10-08", -9, "TOINEN KAHVILA", { status: "pending" })]);
    await importCsv([raw("2026-10-08", -8.5, "ESPRESSO HOUSE", { description: "KORTTIOSTO" })]);
    expect((await rows()).filter((r) => r.includes("pending"))).toEqual(["2026-10-08 pending -900 Toinen Kahvila enablebanking"]);
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

/** A bank whose checking account serves the rows in `feed`, like the real API: by date_from, in pages, and it can fail. */
function feedBank() {
  const bank = mockBank();
  const feed = {
    rows: [] as Record<string, unknown>[],
    pageSize: 100,
    /** Fail the request for this page number (1-based). */
    failAtPage: 0,
    /** Always return a continuation key. */
    endless: false,
    fromDates: [] as string[],
  };
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/accounts/u-card/transactions") return Response.json({ transactions: [] });
    if (url.pathname !== "/accounts/u-chk/transactions") return bank.fetchMock(input, init);
    const from = url.searchParams.get("date_from")!;
    feed.fromDates.push(from);
    const page = Number(url.searchParams.get("continuation_key") ?? "1");
    if (feed.failAtPage === page) return new Response("boom", { status: 500 });
    const visible = feed.rows.filter((r) => String(r.booking_date) >= from);
    const slice = visible.slice((page - 1) * feed.pageSize, page * feed.pageSize);
    const more = feed.endless || page * feed.pageSize < visible.length;
    return Response.json({ transactions: slice, ...(more ? { continuation_key: String(page + 1) } : {}) });
  }) as typeof fetch;
  return { bank, feed, fetchMock };
}

const ebRow = (ref: string, date: string, euros: string, dir: "CRDT" | "DBIT", name: string, status = "BOOK") => ({
  entry_reference: ref,
  transaction_amount: { currency: "EUR", amount: euros },
  credit_debit_indicator: dir,
  status,
  booking_date: date,
  ...(dir === "DBIT" ? { creditor: { name } } : { debtor: { name } }),
  remittance_information: ["KORTTIOSTO"],
});

async function connectedFeed() {
  const f = feedBank();
  const app = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, f.fetchMock);
  await app.admin.call("POST", "/api/connections/start", {});
  await app.admin.call("POST", "/api/connections/complete", { url: `https://x.example/cb?code=abc&state=${f.bank.state}` });
  await waitFor(async () => (await app.admin.call("GET", "/api/sync/runs")).body.runs.every((r: { status: string }) => r.status !== "running"));
  const repo = app.s.finance(app.adminId);
  const chk = (await repo.listAccounts()).find((a) => a.externalId === "u-chk")!;
  const stored = async () => (await repo.transactionsOfAccount(chk.id)).map((r) => `${r.bookingDate} ${r.status} ${r.amountCents} ${r.merchant}`).sort();
  return { ...f, ...app, repo, chk, stored };
}

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
