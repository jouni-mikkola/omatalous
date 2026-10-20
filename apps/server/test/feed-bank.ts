// A bank that serves a checking account's rows from a list, linked to a fresh app: for the tests of a fetch.
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { setupApp, waitFor } from "./helpers.ts";
import { mockBank } from "./mock-bank.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

/** A bank whose checking account serves the rows in `feed`, like the real API: by date_from, in pages, and it can fail. */
export function feedBank() {
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

export const ebRow = (ref: string, date: string, euros: string, dir: "CRDT" | "DBIT", name: string, status = "BOOK") => ({
  entry_reference: ref,
  transaction_amount: { currency: "EUR", amount: euros },
  credit_debit_indicator: dir,
  status,
  booking_date: date,
  ...(dir === "DBIT" ? { creditor: { name } } : { debtor: { name } }),
  remittance_information: ["KORTTIOSTO"],
});

export async function connectedFeed() {
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
