import { expect, test as base } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { linkFakeBank, metaWhileSyncing, watch } from "../helpers.ts";
import { startServer } from "../server.mjs";

// Roadmap, First evening: a new household gets a well-classified picture in one evening. The run starts from an install
// nobody has set up (a server of its own, as app.spec.ts has), makes the administrator, links the fake bank with the
// made-up household of fake-bank/first-evening.mjs and, once the first fetch is done, compares the category the app gave
// each row with the one the household's data expects. A heavy local check: `pnpm first-evening` (it is no part of `pnpm e2e`
// or of CI, see playwright.config.ts). With E2E_INSTALL set (a JSON of base, dir, setupCode and fakeBank) the same steps
// run against an install that already exists, such as the one tools/install-hour.sh makes in a clean container; its
// fake bank is out of reach of this process, so E2E_EVENING_EXPECTED names a file of its /fake/evening-expected answer.
const ADMIN = { username: "ilta-admin", displayName: "Ilta Admin", password: "ilta-salasana-123456" };
/** The share of the rows' value (absolute cents) that must land in the expected category. Never lowered: a miss is fixed in the rules. */
const MIN_SHARE = 0.95;
/** The longest the scripted steps from the empty install to the picture may take. */
const MAX_MINUTES = 30;

type Expected = { account: string; date: string; cents: number; text: string; merchant: string; category: string };
type Row = { accountId: string; bookingDate: string; amountCents: number; description: string | null; merchant: string; category: string };

let app: Awaited<ReturnType<typeof startServer>>;
const test = base.extend({ baseURL: async ({}, use) => use(app?.base) });
test.beforeAll(async () => {
  app = process.env.E2E_INSTALL ? { ...JSON.parse(process.env.E2E_INSTALL), log: () => "", stop: () => {} } : await startServer();
  // the helpers read the server and the fake bank from the environment; this file's server is its own
  process.env.E2E_BASE_URL = app.base;
  process.env.E2E_DIR = app.dir;
  process.env.E2E_FAKE_BANK = app.fakeBank;
});
test.afterAll(() => app?.stop());
test.setTimeout(MAX_MINUTES * 60_000);

test(`from an empty install to a picture in at most ${MAX_MINUTES} minutes, with ${MIN_SHARE * 100} % of the value in the expected category`, async ({ browser }) => {
  const began = Date.now();
  const steps: string[] = [];
  const step = (name: string) => steps.push(`${name}: ${Math.round((Date.now() - began) / 1000)} s`);

  const context = await browser.newContext({ baseURL: app.base, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  try {
    // 1. the install is empty: the setup form is what a visitor gets
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Ota sovellus käyttöön" })).toBeVisible();
    step("empty install");

    // 2. the administrator is made and the wizard is done
    await page.getByLabel("Asennuskoodi").fill(app.setupCode);
    await page.getByLabel("Käyttäjätunnus").fill(ADMIN.username);
    await page.getByLabel("Nimi", { exact: true }).fill(ADMIN.displayName);
    await page.getByLabel("Salasana (vähintään 12 merkkiä)").fill(ADMIN.password);
    await page.getByLabel("Salasana uudelleen").fill(ADMIN.password);
    await page.getByRole("button", { name: "Luo ja kirjaudu" }).click();
    await expect(page.getByRole("heading", { name: "Käyttöönotto" })).toBeVisible();
    await page.getByRole("button", { name: "Ohita" }).click();
    await page.getByRole("button", { name: "Siirry sovellukseen" }).click();
    await expect(page.getByRole("navigation").getByText("Yhteenveto").first()).toBeVisible();
    step("administrator made");

    // 3. the bank is linked and the first fetch is done
    // a page of its own: the one above read the bank's state before the application was saved
    const link = await context.newPage();
    await linkFakeBank(link, { evening: true });
    await expect(link.locator(".notice").filter({ hasText: "Pankki yhdistetty, 3 tiliä" })).toBeVisible();
    await link.close();
        await expect
      .poll(
        async () => {
          const meta = await metaWhileSyncing(context);
          return Boolean(meta?.lastSync?.finishedAt) && meta!.accounts.length === 3 && meta!.accounts.every((a) => a.balanceCents !== null);
        },
        { message: "the first fetch did not finish", timeout: 120_000 },
      )
      .toBe(true);
    step("first fetch done");

    // 4. the picture is drawn
    await page.goto("/#/overview");
    await page.reload();
    await expect(page.getByRole("navigation").getByText("Yhteenveto").first()).toBeVisible();
    await expect(page.getByText("Ei vielä tietoja")).toHaveCount(0);
    // the front page itself, not the skeleton it shows while the dashboard answer is on its way
    await expect(page.locator(".page-grid.front:not(.home-skeleton) .home-tiles")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(".home-skeleton")).toHaveCount(0);
    step("picture drawn");

    // 5. what the app made of every row against what the household's data expects
    const meta = (await (await context.request.get("/api/meta")).json()) as { accounts: { id: string; name: string }[] };
    const names = new Map(meta.accounts.map((a) => [a.id, a.name]));
    const expected = (
      process.env.E2E_EVENING_EXPECTED ? JSON.parse(readFileSync(process.env.E2E_EVENING_EXPECTED, "utf8")) : await (await fetch(`${JSON.parse(app.fakeBank).url}/fake/evening-expected`)).json()
    ) as Expected[];
    const rows: Row[] = [];
    for (let offset = 0; ; offset += 500) {
      const answer = await (await context.request.get(`/api/transactions?limit=500&offset=${offset}`)).json();
      rows.push(...answer.items);
      if (rows.length >= answer.total || answer.items.length === 0) break;
    }
    const key = (account: string | undefined, date: string, cents: number, text: string | null) => `${account}|${date}|${cents}|${text}`;
    const got = new Map<string, Row>();
    for (const r of rows) {
      const k = key(names.get(r.accountId), r.bookingDate, r.amountCents, r.description);
      expect(got.has(k), `two rows look the same: ${k}`).toBe(false);
      got.set(k, r);
    }
    expect(rows.length, "every expected row came in").toBe(expected.length);

    let total = 0;
    let right = 0;
    const wrong = new Map<string, { cents: number; rows: number }>();
    for (const e of expected) {
      const row = got.get(key(e.account, e.date, e.cents, e.text));
      expect(row, `row missing: ${e.account} ${e.date} ${e.cents} ${e.text}`).toBeTruthy();
      const value = Math.abs(e.cents);
      total += value;
      if (row!.category === e.category) right += value;
      else {
        const k = `${e.merchant} (${e.text}): expected ${e.category}, got ${row!.category}`;
        const had = wrong.get(k) ?? { cents: 0, rows: 0 };
        wrong.set(k, { cents: had.cents + value, rows: had.rows + 1 });
      }
    }
    step("rows compared");
    const share = right / total;
    const misses = [...wrong].sort((a, b) => b[1].cents - a[1].cents).map(([k, v]) => `  ${k}: ${v.rows} rows, ${(v.cents / 100).toFixed(2)} €`);
    console.log(`first evening: ${(share * 100).toFixed(2)} % of ${(total / 100).toFixed(2)} € in the expected category, ${rows.length} rows\n${steps.join("\n")}${misses.length ? `\nmisses:\n${misses.join("\n")}` : ""}`);
    expect(share, `the value in the expected category\n${misses.join("\n")}`).toBeGreaterThanOrEqual(MIN_SHARE);
    expect((Date.now() - began) / 60_000, `the scripted steps took ${steps.join(", ")}`).toBeLessThanOrEqual(MAX_MINUTES);
    expect(seen.problems.filter((p) => !/HTTP 4\d\d/.test(p) || /api\/(transactions|meta)/.test(p))).toEqual([]);
  } finally {
    await context.storageState({ path: join(app.dir, "ilta-state.json") });
    await context.close();
  }
});
