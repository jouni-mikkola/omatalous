/**
 * Balances match the rows (1.0 check): in every made-up household the app ships or tests with (the demo, and the four
 * the fake bank of the browser specs brings), the balance of each connected account is what the account held before its
 * first row plus the rows the app stored, to the cent. The rows go through the real fetch (mapper, ingest) or the real
 * demo load, so a row dropped, read twice or read with the wrong sign breaks the sum here. When a sum does not match, the
 * made-up data is wrong, or the app's own counting is: never this test. Sums are made up.
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
// the fake bank is plain JavaScript beside the browser specs and has no declarations
// @ts-expect-error TS7016
import { household, OP_ACCOUNT, OP_BALANCE } from "../../../e2e/fake-bank/household.mjs";
// @ts-expect-error TS7016
import { firstEvening } from "../../../e2e/fake-bank/first-evening.mjs";
// @ts-expect-error TS7016
import { secondHousehold } from "../../../e2e/fake-bank/second-household.mjs";
import { generateDemoData } from "../src/demo-data.ts";
import { loadDemoData } from "../src/demo.ts";
import { NOW, setupApp, waitFor } from "./helpers.ts";
import { mockBank } from "./mock-bank.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const TODAY = NOW.toISOString().slice(0, 10);

type App = Awaited<ReturnType<typeof setupApp>>;

/** One account as the test sees it: what it opened with, what the bank says it holds and how many rows the bank gave. */
interface Expected {
  key: string;
  openingCents: number;
  bankCents: number;
  rows: number;
  /** The sum of those rows as the bank's payload says it, when known; the stored sum must be it. */
  rowCents?: number;
}

interface Stored {
  key: string;
  balanceCents: number | null;
  /** What the first page's holdings show for it: the balance of an account, minus the amount used of a card. */
  shownCents: number | null;
  rowCents: number;
  rows: number;
}

/** Each account's differences from the match, as words; an empty list is a match. At least one account must be checked. */
function mismatches(expected: readonly Expected[], stored: readonly Stored[]): string[] {
  if (!expected.length) return ["no account to check"];
  const out: string[] = [];
  for (const e of expected) {
    const s = stored.find((x) => x.key === e.key);
    if (!s) {
      out.push(`${e.key}: not stored`);
      continue;
    }
    if (s.rows !== e.rows) out.push(`${e.key}: ${s.rows} rows stored, ${e.rows} given`);
    if (e.rowCents !== undefined && s.rowCents !== e.rowCents) out.push(`${e.key}: rows stored add up to ${s.rowCents}, the bank's rows to ${e.rowCents}`);
    if (e.openingCents + s.rowCents !== e.bankCents) out.push(`${e.key}: opening + rows = ${e.openingCents + s.rowCents}, bank says ${e.bankCents}`);
    if (s.balanceCents !== e.bankCents) out.push(`${e.key}: the app holds ${s.balanceCents}, bank says ${e.bankCents}`);
    if (s.shownCents !== e.bankCents) out.push(`${e.key}: the first page shows ${s.shownCents}, bank says ${e.bankCents}`);
  }
  return out;
}

/** The booked rows and the balance of every stored account, by the key `key` names. */
async function stored(app: App, key: (a: { id: string; externalId: string | null; name: string }) => string): Promise<Stored[]> {
  const accounts = (await app.admin.call("GET", "/api/meta")).body.accounts as { id: string; name: string; externalId?: string | null; balanceCents: number | null }[];
  // the household's view holds a joint account whole; the own view shows the viewer's part of it (ADR 0017), which is no balance of the bank's
  const holdings = (await app.admin.call("GET", "/api/dashboard?scope=household")).body.holdings as { accounts: { id: string; balanceCents: number | null }[]; cards: { id: string; usedCents: number | null }[] };
  const shown = new Map<string, number | null>([...holdings.accounts.map((h) => [h.id, h.balanceCents] as const), ...holdings.cards.map((h) => [h.id, h.usedCents === null ? null : -h.usedCents] as const)]);
  const out: Stored[] = [];
  for (const a of accounts) {
    const sum = (await app.db.first<{ cents: number | null; n: number }>("SELECT SUM(amount_cents) AS cents, COUNT(*) AS n FROM transactions WHERE account_id = ? AND status = 'booked'", [a.id]))!;
    out.push({ key: key({ id: a.id, externalId: a.externalId ?? null, name: a.name }), balanceCents: a.balanceCents, shownCents: shown.get(a.id) ?? null, rowCents: sum.cents ?? 0, rows: sum.n });
  }
  return out;
}

interface BankHousehold {
  accounts: { uid: string; currency: string }[];
  transactions: Record<string, { transaction_amount: { amount: string; currency: string }; credit_debit_indicator: string; status: string }[]>;
  balances: Record<string, number>;
  openings: Record<string, number>;
}

/** Links the household through the app's own fetch, the bank answering from the fake bank's data. */
async function link(bank: BankHousehold, extra: { uid: string }[] = []) {
  const mock = mockBank();
  const app = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, mock.fetchMock);
  const all = [...bank.accounts, ...extra] as { uid: string }[];
  await app.admin.call("POST", "/api/connections/start", {});
  mock.answers["POST /sessions"] = { status: 200, body: { session_id: "sess-1", aspsp: { name: "Nordea", country: "FI" }, access: { valid_until: "2027-04-06T00:00:00Z" }, accounts: all } };
  for (const a of all) {
    const uid = a.uid;
    mock.answers[`GET /accounts/${uid}/details`] = { status: 200, body: a };
    mock.answers[`GET /accounts/${uid}/transactions`] = { status: 200, body: { transactions: bank.transactions[uid] ?? [] } };
    const amount = { currency: "EUR", amount: ((bank.balances[uid] ?? 0) / 100).toFixed(2) };
    mock.answers[`GET /accounts/${uid}/balances`] = { status: 200, body: { balances: [{ name: "Kirjattu saldo", balance_amount: amount, balance_type: "CLBD", reference_date: TODAY }] } };
  }
  expect((await app.admin.call("POST", "/api/connections/complete", { url: `?code=abc&state=${mock.state}` })).status).toBe(200);
  await waitFor(async () => (await app.admin.call("GET", "/api/sync/runs")).body.runs.every((r: { status: string }) => r.status !== "running"));
  return app;
}

/** The bank's own amount text in cents, read as digits and not as a float: "12.30" is 1230. */
const centsOf = (amount: string) => {
  const [euros = "0", fraction = ""] = amount.split(".");
  return Number(euros) * 100 + Number(fraction.padEnd(2, "0"));
};

/**
 * What the bank's answer says of each account, read from the rows as the bank sent them (the amount text and the debit or
 * credit mark) and not from the numbers the data was built from: rows in euros that are booked, their sum and count.
 */
function expectedOf(bank: BankHousehold, uids: string[]): Expected[] {
  return uids.map((uid) => {
    const rows = (bank.transactions[uid] ?? []).filter((t) => t.status === "BOOK" && t.transaction_amount.currency === "EUR");
    const sum = rows.reduce((total, t) => total + (t.credit_debit_indicator === "DBIT" ? -1 : 1) * centsOf(t.transaction_amount.amount), 0);
    return { key: uid, openingCents: bank.openings[uid]!, bankCents: bank.balances[uid]!, rows: rows.length, rowCents: sum };
  });
}

async function checkBank(bank: BankHousehold, extra: { uid: string }[] = []) {
  const app = await link(bank, extra);
  const rows = await app.db.all<{ id: string; external_id: string }>("SELECT id, external_id FROM accounts");
  const uidOf = new Map(rows.map((r) => [r.id, r.external_id]));
  const uids = [...bank.accounts.map((a) => a.uid), ...extra.map((a) => a.uid)];
  const found = await stored(app, (a) => uidOf.get(a.id) ?? a.id);
  return { expected: expectedOf(bank, uids), found };
}

describe("the fake bank's households", () => {
  it("the household, its dollar account and OP's account: every balance is its opening plus the rows the app stored", async () => {
    const bank = household(TODAY);
    // OP's account has no rows: it holds what it opened with
    bank.openings[OP_ACCOUNT.uid] = OP_BALANCE;
    bank.balances[OP_ACCOUNT.uid] = OP_BALANCE;
    const { expected, found } = await checkBank(bank, [OP_ACCOUNT, bank.dollarAccount]);
    expect(expected.map((e) => e.key).sort()).toEqual(["fb-card", "fb-chk", "fb-joint", "fb-op", "fb-sav", "fb-usd"]);
    // the dollar row is no euro row: the account holds the euro rows only
    expect(expected.find((e) => e.key === "fb-usd")).toMatchObject({ rows: 1, rowCents: 5000 });
    expect(mismatches(expected, found)).toEqual([]);
  });

  it("the same household under other ids, and the first evening's household, match as well", async () => {
    const own = await checkBank(household(TODAY, true));
    expect(own.expected).toHaveLength(4);
    expect(mismatches(own.expected, own.found)).toEqual([]);
    const evening = await checkBank(firstEvening(TODAY));
    expect(evening.expected).toHaveLength(3);
    expect(mismatches(evening.expected, evening.found)).toEqual([]);
  });

  it("the second household at OP, with its reserved rows left out of the sums, matches too", async () => {
    const second = await checkBank(secondHousehold(TODAY));
    expect(second.expected.map((e) => e.key).sort()).toEqual(["sh-card", "sh-chk", "sh-sav"]);
    expect(mismatches(second.expected, second.found)).toEqual([]);
  });
});

describe.each([14, 26] as const)("the demo household of %i months", (months) => {
  it("every account's balance is its opening plus its booked rows, as stored and as the first page shows it", async () => {
    const app = await setupApp();
    // the generator is seeded: the same days give the same rows as the load below
    const data = generateDemoData(TODAY, months);
    await loadDemoData(app.s.finance(app.adminId), app.s.settings, TODAY, months);
    const expected = data.map((a) => ({
      key: a.name,
      openingCents: a.openingCents,
      bankCents: a.balanceCents!,
      rows: a.transactions.filter((t) => t.status === "booked").length,
      rowCents: a.transactions.filter((t) => t.status === "booked").reduce((sum, t) => sum + t.amountCents, 0),
    }));
    const found = await stored(app, (a) => a.name);
    expect(expected).toHaveLength(3);
    expect(mismatches(expected, found)).toEqual([]);
  });
});

describe("the check itself", () => {
  const e: Expected = { key: "a", openingCents: 100, bankCents: 350, rows: 2, rowCents: 250 };
  const s: Stored = { key: "a", balanceCents: 350, shownCents: 350, rowCents: 250, rows: 2 };

  it("passes only when the opening and the rows give the bank's balance to the cent, and the app holds that balance", () => {
    expect(mismatches([e], [s])).toEqual([]);
  });

  it("fails on a cent off in the rows, in the balance, a lost row, a missing account, or nothing to check", () => {
    expect(mismatches([e], [{ ...s, rowCents: 251 }])).not.toEqual([]);
    expect(mismatches([{ ...e, rowCents: 251 }], [s])).toHaveLength(1);
    expect(mismatches([e], [{ ...s, balanceCents: 351 }])).toHaveLength(1);
    expect(mismatches([e], [{ ...s, balanceCents: null }])).toHaveLength(1);
    expect(mismatches([e], [{ ...s, shownCents: 349 }])).toHaveLength(1);
    expect(mismatches([e], [{ ...s, rows: 1 }])).toHaveLength(1);
    expect(mismatches([e], [])).toHaveLength(1);
    expect(mismatches([], [s])).toEqual(["no account to check"]);
  });
});
