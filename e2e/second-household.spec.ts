import { expect, test, type BrowserContext } from "@playwright/test";
import { fakeBank, linkFakeBank, makeMember, removeMember, waitForSync, watch } from "./helpers.ts";

// Roadmap, Second household, second bank: a second household at a second bank goes through sync, classification and the
// reports beside a first household, in one suite. The first household (the fake bank's Nordea household) is linked by
// one member, read whole, and read again after the second household (fake-bank/second-household.mjs at OP, rows worded
// the way that bank words them) is linked by another: nothing of the first may differ. The second household's rows are
// compared with the category its data expects, and neither member sees a row or an account of the other.
const FIRST = "e2e-talous-yksi";
const SECOND = "e2e-talous-kaksi";
/** The answers that carry the household's figures: the dashboard, the day ahead, the reports and Optimoi. */
const FIGURES = ["/api/dashboard", "/api/ahead", "/api/reports", "/api/optimise"];

type Expected = { account: string; date: string; cents: number; text: string; merchant: string; category: string };
type Pending = { account: string; date: string; cents: number; text: string; merchant: string };
type Row = { id: string; accountId: string; bookingDate: string; amountCents: number; description: string | null; merchant: string; category: string; status: string };
type Meta = { accounts: { id: string; name: string; balanceCents: number | null }[] };

let first: { state: string; id: string };
let second: { state: string; id: string };
const FETCH = { "X-Requested-With": "fetch" };
// the household's own application is saved so that the bank list offers OP beside Nordea, and taken away at the end
test.beforeAll(async ({ browser }) => {
  first = await makeMember(browser, FIRST);
  second = await makeMember(browser, SECOND);
  const admin = await browser.newContext({ storageState: `${process.env.E2E_DIR}/admin-state.json` });
  const bank = fakeBank();
  expect((await admin.request.put("/api/admin/bank-app", { data: { appId: bank.appId, privateKeyPem: bank.privateKeyPem }, headers: FETCH })).ok()).toBe(true);
  await admin.close();
});
test.afterAll(async ({ browser }) => {
  const admin = await browser.newContext({ storageState: `${process.env.E2E_DIR}/admin-state.json` });
  expect((await admin.request.delete("/api/admin/bank-app", { headers: FETCH })).ok()).toBe(true);
  await admin.close();
  await removeMember(browser, first.id);
  await removeMember(browser, second.id);
});

async function get<T>(context: BrowserContext, path: string): Promise<T> {
  const answer = await context.request.get(path);
  expect(answer.status(), path).toBe(200);
  return (await answer.json()) as T;
}

/** The answers of FIGURES as text, the member's id written as a name so a comparison does not read an id as a figure. */
async function figures(context: BrowserContext, id: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const path of FIGURES) out[path] = JSON.stringify(await get(context, path)).replaceAll(id, "user:first");
  return out;
}

async function allRows(context: BrowserContext): Promise<Row[]> {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 500) {
    const answer = await get<{ total: number; items: Row[] }>(context, `/api/transactions?limit=500&offset=${offset}`);
    rows.push(...answer.items);
    if (rows.length >= answer.total || answer.items.length === 0) return rows;
  }
}

test("a second household at a second bank is synced, classified and reported, and the first household's figures do not move", async ({ browser }) => {
  const bank = fakeBank();
  const one = await browser.newContext({ storageState: first.state, viewport: { width: 1280, height: 900 } });
  const two = await browser.newContext({ storageState: second.state, viewport: { width: 1280, height: 900 } });
  const onePage = await one.newPage();
  const twoPage = await two.newPage();
  const seen = watch(twoPage);

  // the first household: Nordea, its own joint account so that no other spec's link shares it
  await linkFakeBank(onePage, { own: true });
  await waitForSync(one);
  // the joint account's settlement is frozen by a job on the side after the first read (services/settlement.ts), so the
  // first household is read until that has landed and only then taken as the "before"
  await expect.poll(async () => JSON.parse((await figures(one, first.id))["/api/dashboard"]!).settlement.length, { message: "the settlement has landed" }).toBeGreaterThan(0);
  const before = await figures(one, first.id);
  const rowsBefore = await allRows(one);
  const metaBefore = await get<Meta>(one, "/api/meta");
  expect(metaBefore.accounts, "the first household has its four accounts").toHaveLength(4);
  expect(rowsBefore.length).toBeGreaterThan(300);

  // the second household: OP, three accounts
  await linkFakeBank(twoPage, { bank: "OP", second: true });
  await expect(twoPage.locator(".notice").filter({ hasText: "Pankki yhdistetty, 3 tiliä" })).toBeVisible();
  await waitForSync(two);

  // sync: every account has the balance the bank gave, and every booked row is stored once; reserved rows are kept as pending
  const metaTwo = await get<Meta>(two, "/api/meta");
  const { expected, pending } = (await (await fetch(`${bank.url}/fake/second-expected`)).json()) as { expected: Expected[]; pending: Pending[] };
  const names = new Map(metaTwo.accounts.map((a) => [a.id, a.name]));
  expect(metaTwo.accounts.map((a) => a.name).sort()).toEqual(["OP Visa Credit", "OP-käyttötili", "OP-pikasäästötili"]);
  for (const a of metaTwo.accounts) {
    const uid = ({ "OP Visa Credit": "sh-card", "OP-käyttötili": "sh-chk", "OP-pikasäästötili": "sh-sav" } as Record<string, string>)[a.name]!;
    const said = await (await fetch(`${bank.url}/accounts/${uid}/balances`, { headers: { Authorization: "Bearer test" } })).json();
    expect(a.balanceCents, `${a.name} holds what the bank said`).toBe(Math.round(Number(said.balances[0].balance_amount.amount) * 100));
  }
  const rows = await allRows(two);
  const booked = rows.filter((r) => r.status === "booked");
  expect(booked.length, "every booked row came in once").toBe(expected.length);
  expect(rows.filter((r) => r.status === "pending").map((r) => r.amountCents).sort(), "the reserved rows are kept as reserved").toEqual(pending.map((p) => p.cents).sort());

  // classification: every booked row has the category its data expects
  const key = (account: string | undefined, date: string, cents: number, text: string | null) => `${account}|${date}|${cents}|${text}`;
  const got = new Map<string, Row>();
  for (const r of booked) {
    const k = key(names.get(r.accountId), r.bookingDate, r.amountCents, r.description);
    expect(got.has(k), `two rows look the same: ${k}`).toBe(false);
    got.set(k, r);
  }
  const wrong: string[] = [];
  for (const e of expected) {
    const row = got.get(key(e.account, e.date, e.cents, e.text));
    expect(row, `row missing: ${e.account} ${e.date} ${e.cents} ${e.text}`).toBeTruthy();
    if (row!.category !== e.category) wrong.push(`${e.merchant} (${e.text}, ${e.cents}): expected ${e.category}, got ${row!.category}`);
  }
  expect([...new Set(wrong)], "rows in a category other than the expected").toEqual([]);

  // isolation: neither member sees an account or a row of the other
  const metaOneNow = await get<Meta>(one, "/api/meta");
  expect(metaOneNow.accounts.map((a) => a.id).sort()).toEqual(metaBefore.accounts.map((a) => a.id).sort());
  const ids = new Set(metaTwo.accounts.map((a) => a.id));
  const rowsOneNow = await allRows(one);
  expect(rowsOneNow.some((r) => ids.has(r.accountId)), "the first member sees a row of the second household").toBe(false);
  expect(rows.some((r) => !ids.has(r.accountId)), "the second member sees a row of the first household").toBe(false);
  expect(rowsOneNow.map((r) => `${r.id}|${r.category}`).sort()).toEqual(rowsBefore.map((r) => `${r.id}|${r.category}`).sort());

  // the pages draw from the second household's rows: each waits for a euro figure in its own frame (the nav is there before any data), and an empty-state text or an alert is a failure
  for (const [address, frame] of [["overview", "main"], ["reports", ".q-frame"], ["reports?q=tulot", ".q-frame"], ["reports?q=menot", ".q-frame"], ["bills", "main"], ["transactions", "main"]] as const) {
    await twoPage.goto(`/#/${address}`);
    await twoPage.reload();
    await expect(twoPage.locator(frame).first(), address).toContainText(/\d\s*€/);
    await expect(twoPage.getByText("Ei vielä tietoja"), address).toHaveCount(0);
    await expect(twoPage.getByRole("alert"), address).toHaveCount(0);
  }
  // the figures are the second household's alone: its accounts and card add up to the bank's balances, and nothing of the first is in them
  const dashboard = await get<{ holdings: { accountsCents: number; cardsCents: number; accounts: { name: string }[]; cards: { name: string; limitCents: number }[] } }>(two, "/api/dashboard");
  const held = (type: string) => metaTwo.accounts.filter((a) => a.name !== "OP Visa Credit" === (type === "accounts")).reduce((sum, a) => sum + (a.balanceCents ?? 0), 0);
  expect(dashboard.holdings.accounts.map((a) => a.name).sort()).toEqual(["OP-käyttötili", "OP-pikasäästötili"]);
  expect(dashboard.holdings.accountsCents).toBe(held("accounts"));
  expect(dashboard.holdings.cards).toMatchObject([{ name: "OP Visa Credit", limitCents: 250_000 }]);
  expect(dashboard.holdings.cardsCents).toBe(-held("cards"));
  for (const path of FIGURES) expect(JSON.stringify(await get(two, path)).toLowerCase(), `${path} of the second household holds nothing of the first`).not.toMatch(/meikalainen|yhteistili|esimerkki sahko/);

  // the first household, read whole again: no figure moved
  const after = await figures(one, first.id);
  for (const path of FIGURES) {
    // the first place that differs, with what stands around it: a whole answer is too long to read in a failure
    const at = [...before[path]!].findIndex((c, i) => c !== after[path]![i]);
    const around = (text: string) => (at < 0 ? "" : text.slice(Math.max(0, at - 120), at + 120));
    expect(around(after[path]!), `${path} of the first household differs at ${at}`).toBe(around(before[path]!));
    expect(after[path], `${path} of the first household`).toBe(before[path]);
  }

  expect(seen.problems.filter((p) => !/HTTP 4\d\d/.test(p))).toEqual([]);
  await one.close();
  await two.close();
});
