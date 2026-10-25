import { type Browser, expect, type Page, test } from "@playwright/test";
import { join } from "node:path";
import { overflow, plain, watch } from "./helpers.ts";

// Tarkistettavat: every question the app cannot settle itself, one at a time. The queue is a stub of /api/review that
// follows the answers the page sends (a rule, a mark, a payer's role, an account's answer), with every payee and sum made
// up; the server's tests (apps/server/test/review.test.ts) hold what each answer does to the rows. Each answer must go to
// its own source's route, the next item must show at once, and the count in the header must follow.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
/** Set by a run that wants pictures of the page: SHOTS_DIR=$TMPDIR/shots pnpm e2e e2e/tr1.spec.ts */
const SHOTS = process.env.SHOTS_DIR;

type Item = { id: string; kind: string; cents: number; [field: string]: unknown };

const loan: Item = { kind: "loan", id: "loan:out:chk:Esimerkkirahoitus#25000", cents: 300_000, key: "out:chk:Esimerkkirahoitus#25000", payee: "Esimerkkirahoitus", paymentCents: 25_000, months: 9, firstDate: "2026-01-05", lastDate: "2026-09-05", guess: "car", placed: false };
/** The shop's own rows as the server sends them, the newest first: its display name and the bank's raw text. */
const shopRows = [20, 19, 18, 17, 16].map((d, n) => ({ id: `r${n}`, date: `2026-09-${d}`, cents: -8450, name: "Esimerkki Kauppa Oy", text: "KORTTIOSTO ESIMERKKI KAUPPA" }));
const shop: Item = { kind: "payee_out", id: "payee_out:Esimerkki Kauppa Oy", cents: 76_050, merchant: "Esimerkki Kauppa Oy", count: 5, lastDate: "2026-09-20", picks: ["groceries", "restaurants", "car", "shopping"], rows: shopRows, rowCount: 5 };
const payer: Item = { kind: "payer", id: "payer:name:ESIMERKKI VILLE", cents: 60_000, key: "name:ESIMERKKI VILLE", merchant: "Esimerkki Ville", count: 3, lastDate: "2026-09-03", options: ["cost_share", "sales", "own_money", "gift", "pay"], proposal: "cost_share" };
const split: Item = { kind: "split", id: "split:acc-1:in:g:text:KAVERI", cents: 45_000, accountId: "acc-1", accountName: "Yhteistili", question: "in", key: "g:text:KAVERI", label: "Esimerkki Kaveri" };
const sub: Item = { kind: "subscription", id: "subscription:out:chk:Esimerkkistream", cents: 15_588, seriesId: "out:chk:Esimerkkistream", subject: "series:out:chk:Esimerkkistream#1299", merchant: "Esimerkkistream", monthlyCents: 1299, lastDate: "2026-10-08" };
const plan: Item = { kind: "plan", id: "plan:out:chk:Esimerkkiosamaksu#4990", cents: 59_880, key: "out:chk:Esimerkkiosamaksu#4990", payee: "Esimerkkiosamaksu", paymentCents: 4990, lastDate: "2026-09-12" };
const gift: Item = { kind: "payee_in", id: "payee_in:Esimerkki Täti", cents: 10_000, merchant: "Esimerkki Täti", count: 1, lastDate: "2026-06-12", picks: ["salary"] };

interface Stub {
  items: Item[];
  posted: { path: string; method: string; body: unknown }[];
}

/** The queue of the stub; an answer the page sends takes its item out of it. */
async function follow(page: Page, items: Item[]): Promise<Stub> {
  const stub: Stub = { items: [...items], posted: [] };
  const drop = (test: (i: Item) => boolean) => (stub.items = stub.items.filter((i) => !test(i)));
  await page.route(/\/api\/review$/, (route) => route.fulfill({ json: { items: stub.items } }));
  const record = async (route: Parameters<Parameters<Page["route"]>[1]>[0], json: unknown, remove: (body: any) => (i: Item) => boolean) => {
    const req = route.request();
    const body = req.postDataJSON();
    stub.posted.push({ path: new URL(req.url()).pathname, method: req.method(), body });
    drop(remove(body));
    await route.fulfill({ json });
  };
  await page.route(/\/api\/rules$/, (route) => (route.request().method() === "POST" ? record(route, {}, (b) => (i) => i.merchant === b.pattern && String(i.kind).startsWith("payee")) : route.fallback()));
  await page.route(/\/api\/payer-roles$/, (route) => (route.request().method() === "PUT" ? record(route, { ok: true }, (b) => (i) => i.key === b.key) : route.fallback()));
  await page.route(/\/api\/accounts\/[^/]+\/answers$/, (route) => record(route, { ok: true }, (b) => (i) => i.kind === "split" && i.key === b.key));
  await page.route(/\/api\/marks$/, (route) =>
    record(route, { marks: [] }, (b) => {
      const subject = String(b.subject);
      return (i) => subject === i.subject || subject === `question:payee:${i.merchant}` || subject === `loan-proposal:${i.key}` || subject.endsWith(`:${i.key}`) || subject.endsWith(`:${String(i.key)}`);
    }),
  );
  // the card reads its rows from the item alone: a request for a payee's rows is a fault
  await page.route(/\/api\/transactions\?/, (route) => {
    stub.posted.push({ path: "/api/transactions", method: "GET", body: null });
    return route.fulfill({ json: { items: [], total: 0, inCents: 0, outCents: 0 } });
  });
  return stub;
}

async function open(browser: Browser, width: number, items: Item[]) {
  const context = await browser.newContext({ storageState: STATE, viewport: { width, height: width < 600 ? 844 : 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  const stub = await follow(page, items);
  await page.goto("/#/review");
  await expect(page.locator(".review-item, .review-end").first()).toBeVisible({ timeout: 15_000 });
  return { context, page, seen, stub };
}

const card = (page: Page) => page.locator(".review-item");
const question = (page: Page) => card(page).getByRole("heading", { level: 2 });
const headerCount = (page: Page) => page.locator(".review-link .nav-count");

test("each kind is asked in its own words and answered through its own route, the next item at once and the count following", async ({ browser }) => {
  const { context, page, seen, stub } = await open(browser, 1280, [loan, shop, payer, split, sub, gift]);
  await expect(headerCount(page)).toHaveText("6 avoinna");
  await expect(page.getByRole("link", { name: "Tarkistettavat 6 avoinna" })).toHaveAttribute("aria-current", "page");
  // the head is the sitting: what is open, and a track of this sitting; no sentence about the known share
  await expect(page.locator(".review-datum")).toHaveText(/^6\s*jäljellä$/);
  await expect(page.getByRole("progressbar", { name: "Tämä kerta" })).toHaveAttribute("aria-valuenow", "0");

  // the most money first: a loan the app cannot place, its guess first and marked
  await expect(card(page).locator(".review-kind")).toHaveText("Laina");
  await expect(card(page).locator(".review-name")).toHaveText("Esimerkkirahoitus");
  expect(plain(await card(page).locator(".review-figure").textContent() ?? "")).toBe("250,00 € kuussa");
  await expect(question(page)).toHaveText("Mikä laina tämä on?");
  const choices = card(page).locator(".review-choice");
  await expect(choices.first()).toHaveAccessibleName("Autolaina Ehdotus");
  // the guess is framed, not filled: nothing reads as already chosen
  await expect(choices.first()).toHaveClass(/is-guess/);
  await expect(card(page).locator(".review-choice.btn-primary")).toHaveCount(0);
  await expect(choices.last()).toHaveText("Ei laina");
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "tr1-loan-1280.png"), fullPage: true });
  await choices.last().click();
  await expect(card(page).locator(".review-name")).toHaveText("Esimerkki Kauppa Oy");
  await expect(question(page)).toBeFocused();
  await expect.poll(() => stub.posted.at(-1)).toEqual({ path: "/api/marks", method: "PUT", body: { subject: `loan-proposal:${loan.key}`, mark: "dismissed" } });
  await expect(headerCount(page)).toHaveText("5 avoinna");
  await expect(page.locator(".review-datum")).toHaveText(/^5\s*jäljellä$/);

  // a payee: the rows behind it on a tap, then a category saved as the rule the old card saved
  // the three newest rows stand under the figure; the figure itself opens the rest, with no link text
  const rows = card(page).getByRole("list", { name: "Viimeisimmät tapahtumat: Esimerkki Kauppa Oy" }).getByRole("listitem");
  await expect(rows).toHaveCount(3);
  // the payee's display name leads each row and the bank's raw text follows, quieter
  await expect(rows.first().locator(".review-row-name")).toHaveText("Esimerkki Kauppa Oy");
  await expect(rows.first().locator(".review-row-text")).toHaveText("KORTTIOSTO ESIMERKKI KAUPPA");
  // every figure names its period: the payee's is the last year's
  // (the button holds a hidden action after the figure, for the name a screen reader hears)
  expect(plain(await card(page).locator(".review-figure").textContent() ?? "")).toMatch(/^760,50 € vuodessa(, näytä tapahtumat: Esimerkki Kauppa Oy)?$/);
  const figure = card(page).getByRole("button", { name: /näytä tapahtumat: Esimerkki Kauppa Oy$/ });
  await figure.click();
  await expect(rows).toHaveCount(5);
  await expect(card(page).getByRole("button", { name: /piilota tapahtumat: Esimerkki Kauppa Oy$/ })).toHaveAttribute("aria-expanded", "true");
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "tr1-payee-rows-1280.png"), fullPage: true });
  await expect(question(page)).toHaveText("Mihin kategoriaan nämä maksut kuuluvat?");
  // the household's most used categories as buttons, none marked as a guess, then the sheet of every category; no select
  await expect(card(page).locator("select")).toHaveCount(0);
  await expect(card(page).locator(".review-choice")).toHaveText(["Ruokakauppa", "Ravintolat ja kahvilat", "Auto, polttoaine ja pysäköinti", "Vaatteet ja ostokset", "Muu kategoria…"]);
  await expect(card(page).locator(".review-guess")).toHaveCount(0);
  await card(page).getByRole("button", { name: "Muu kategoria…" }).click();
  const sheet = page.getByRole("dialog", { name: "Valitse kategoria" });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("Hae kategoriaa").fill("ravin");
  await expect(sheet.locator(".review-choice")).toHaveText(["Ravintolat ja kahvilat"]);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "tr1-category-sheet-1280.png") });
  await sheet.getByRole("button", { name: "Peruuta" }).click();
  await expect(sheet).toHaveCount(0);
  await card(page).getByRole("button", { name: "Ruokakauppa" }).click();
  await expect(card(page).locator(".review-name")).toHaveText("Esimerkki Ville");
  await expect.poll(() => stub.posted.at(-1)).toEqual({ path: "/api/rules", method: "POST", body: { field: "merchant_exact", pattern: "Esimerkki Kauppa Oy", category: "groceries" } });

  // a payer: the proposal first, and the answer is the member's own role
  await expect(choices.first()).toHaveAccessibleName("Yhteisten menojen osuus Ehdotus");
  await expect(card(page).locator(".review-note")).toContainText("Vastaus koskee myös aiempia kuukausia.");
  await card(page).getByRole("button", { name: "Palkka tai etuus" }).click();
  await expect(card(page).locator(".review-kind")).toHaveText("Yhteinen tili: Yhteistili");
  await expect.poll(() => stub.posted.at(-1)).toEqual({ path: "/api/payer-roles", method: "PUT", body: { key: payer.key, role: "pay" } });

  // a shared account's money: no guess (a split exists only when a member said it), "Yhteistä" and "En tiedä"
  await expect(question(page)).toHaveText("Kenen rahaa tämä oli?");
  await expect(card(page).locator(".review-guess")).toHaveCount(0);
  await expect(card(page).locator(".review-choice.is-guess")).toHaveCount(0);
  await card(page).getByRole("button", { name: "Yhteistä" }).click();
  await expect(card(page).locator(".review-kind")).toHaveText("Tilaus");
  await expect.poll(() => stub.posted.at(-1)).toEqual({ path: "/api/accounts/acc-1/answers", method: "PUT", body: { kind: "in", key: split.key, owner: "all" } });

  // Ohita sends nothing and the item waits for the next sitting
  await expect(question(page)).toHaveText("Onko tilaus vielä käytössä?");
  const before = stub.posted.length;
  const left = Number(/^\d+/.exec(plain(await page.locator(".review-datum").innerText()))![0]);
  await card(page).getByRole("button", { name: "Ohita" }).click();
  // Ohita moves the count as it moves the track: one count, one truth
  await expect(page.locator(".review-datum")).toHaveText(new RegExp(`^${left - 1}\\s*jäljellä$`));
  await expect(card(page).locator(".review-name")).toHaveText("Esimerkki Täti");
  expect(stub.posted).toHaveLength(before);

  // money in: "Älä kysy enää" is the old Ohita's mark on the payee
  await expect(question(page)).toHaveText("Mitä tämä tulo on?");
  await card(page).getByRole("button", { name: "Älä kysy enää" }).click();
  await expect.poll(() => stub.posted.at(-1)).toEqual({ path: "/api/marks", method: "PUT", body: { subject: "question:payee:Esimerkki Täti", mark: "dismissed" } });

  // only the skipped one is left
  await expect(page.getByRole("heading", { name: "Loput ohitettu" })).toBeVisible();
  await expect(page.getByText("Jäljellä on 1 kohde. Se odottaa seuraavaa kertaa.")).toBeVisible();
  await expect(headerCount(page)).toHaveText("1 avoinna");
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("on a phone three items are answered with large buttons, and nothing scrolls sideways", async ({ browser }) => {
  const { context, page, seen, stub } = await open(browser, 390, [sub, payer, gift]);
  await expect(headerCount(page)).toHaveText("3 avoinna");
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  // the choices wrap two to a row, each at least a thumb high and near half the card
  const first = await card(page).locator(".review-choice").first().boundingBox();
  const box = await card(page).boundingBox();
  expect(first!.height).toBeGreaterThanOrEqual(44);
  expect(first!.width).toBeGreaterThan(box!.width * 0.4);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "tr1-subscription-390.png"), fullPage: true });

  await card(page).getByRole("button", { name: "Käytössä" }).click();
  await expect.poll(() => stub.posted.at(-1)).toEqual({ path: "/api/marks", method: "PUT", body: { subject: sub.subject, mark: "in_use" } });
  await card(page).getByRole("button", { name: "Myynti" }).click();
  await expect.poll(() => stub.posted.at(-1)?.body).toEqual({ key: payer.key, role: "sales" });
  await card(page).getByRole("button", { name: "Muu kategoria…" }).click();
  await page.getByRole("dialog", { name: "Valitse kategoria" }).getByLabel("Hae kategoriaa").fill("henkil");
  await page.getByRole("dialog", { name: "Valitse kategoria" }).getByRole("button", { name: "Maksut henkilöiltä" }).click();
  await expect.poll(() => stub.posted.at(-1)?.body).toEqual({ field: "merchant_exact", pattern: "Esimerkki Täti", category: "p2p_in" });
  await expect(page.getByRole("heading", { name: "Kaikki tarkistettu" })).toBeVisible();
  await expect(headerCount(page)).toHaveCount(0);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "tr1-done-390.png"), fullPage: true });
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a payee's guess comes first, framed, with its reason below; the rest are the household's most used, unmarked", async ({ browser }) => {
  const guessed: Item = { ...shop, id: "payee_out:Happy Dog Trimmi West", merchant: "Happy Dog Trimmi West", picks: ["pets", "groceries", "restaurants", "car"], guess: { category: "pets", reason: "Sama luokka kuin Happy Dog Trimmi East" } };
  const { context, page, seen, stub } = await open(browser, 390, [guessed, shop]);
  const choices = card(page).locator(".review-choices .review-choice");
  await expect(choices.first()).toHaveAccessibleName("Lemmikit Ehdotus");
  await expect(choices.first()).toHaveClass(/is-guess/);
  await expect(card(page).locator(".review-choice.is-guess")).toHaveCount(1);
  await expect(card(page).locator(".review-note")).toHaveText("Ehdotuksen peruste: sama luokka kuin Happy Dog Trimmi East.");
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "tr1-guess-390.png"), fullPage: true });
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await choices.first().click();
  expect(stub.posted.at(-1)).toEqual({ path: "/api/rules", method: "POST", body: { field: "merchant_exact", pattern: "Happy Dog Trimmi West", category: "pets" } });
  // a payee with no guess: nothing framed, no reason
  await expect(card(page).locator(".review-name")).toHaveText("Esimerkki Kauppa Oy");
  await expect(card(page).locator(".review-choice.is-guess")).toHaveCount(0);
  await expect(card(page).locator(".review-note")).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("an instalment plan is asked how many payments are left: a count, a month or En tiedä, each a mark on the plan", async ({ browser }) => {
  const second = { ...plan, id: "plan:two", key: "out:chk:Toinen#2500", payee: "Toinen osamaksu" };
  const third = { ...plan, id: "plan:three", key: "out:chk:Kolmas#1500", payee: "Kolmas osamaksu", cents: 100 };
  const { context, page, seen, stub } = await open(browser, 390, [plan, second, third]);
  await expect(card(page).locator(".review-kind")).toHaveText("Osamaksu");
  await expect(question(page)).toHaveText("Montako maksua on vielä jäljellä?");
  const save = card(page).getByRole("button", { name: "Tallenna", exact: true });
  await expect(save).toBeDisabled();
  await card(page).getByLabel("Maksuja jäljellä").fill("6");
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "tr1-plan-390.png"), fullPage: true });
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await save.click();
  await expect.poll(() => stub.posted.at(-1)?.body).toEqual({ subject: `question:plan-end:2027-03:${plan.key}`, mark: "in_use" });
  await expect(card(page).locator(".review-name")).toHaveText("Toinen osamaksu");
  await card(page).getByLabel("Viimeinen kuukausi").fill("2027-01");
  await card(page).getByRole("button", { name: "Tallenna kuukausi" }).click();
  await expect.poll(() => stub.posted.at(-1)?.body).toEqual({ subject: `question:plan-end:2027-01:${second.key}`, mark: "in_use" });
  await card(page).getByRole("button", { name: "En tiedä" }).click();
  await expect.poll(() => stub.posted.at(-1)?.body).toEqual({ subject: `question:plan-unknown:${third.key}`, mark: "in_use" });
  await expect(page.getByRole("heading", { name: "Kaikki tarkistettu" })).toBeVisible();
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("at 390 the loan's kinds stand two to a row, and a first run with no bank says there is nothing to check yet", async ({ browser }) => {
  const { context, page, seen, stub } = await open(browser, 390, [loan]);
  const kinds = card(page).locator(".review-choice");
  const [a, b] = [await kinds.nth(0).boundingBox(), await kinds.nth(1).boundingBox()];
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "tr1-loan-390.png"), fullPage: true });
  expect(stub.posted.filter((p) => p.path === "/api/transactions")).toEqual([]);

  // no account and nothing shared: no tick, and the way to connect a bank
  await page.route(/\/api\/meta$/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), accounts: [], sharedAccounts: [] } });
  });
  stub.items = [];
  await page.reload();
  await expect(page.getByRole("heading", { name: "Ei vielä tarkistettavaa" })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".review-done-mark")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Yhdistä pankki" })).toHaveAttribute("href", "#/settings?add=1");
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a sitting ends after 25 items with the count left", async ({ browser }) => {
  const many = Array.from({ length: 30 }, (_, n): Item => ({ ...shop, id: `payee_out:Kauppa ${n}`, merchant: `Esimerkki Kauppa ${n}`, cents: 100_000 - n }));
  const { context, page, seen } = await open(browser, 1280, many);
  for (let n = 1; n <= 25; n++) {
    await expect(page.getByRole("progressbar", { name: "Tämä kerta" })).toHaveAttribute("aria-valuenow", String(n - 1));
    await expect(page.getByRole("progressbar", { name: "Tämä kerta" })).toHaveAttribute("aria-valuemax", "25");
    await card(page).getByRole("button", { name: n % 2 ? "Ohita" : "Älä kysy enää" }).click();
  }
  await expect(page.getByRole("heading", { name: "Riittää tältä kertaa" })).toBeVisible();
  // 12 answered, 13 skipped: 18 wait for the next sitting
  await expect(page.getByText("Jäljellä on 18 kohdetta. Ne odottavat seuraavaa kertaa.")).toBeVisible();
  await expect(headerCount(page)).toHaveText("18 avoinna");
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("no other page asks: Yhteenveto has no question card, and the count is the header's alone", async ({ browser }) => {
  const { context, page, seen } = await open(browser, 1280, [shop, gift]);
  await page.goto("/#/overview");
  await expect(page.locator(".key-figures, [aria-label='Tilannekuva']").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("region", { name: "Luokittelemattomat" })).toHaveCount(0);
  await expect(page.locator(".question-row")).toHaveCount(0);
  await expect(headerCount(page)).toHaveText("2 avoinna");
  await page.getByRole("link", { name: "Tarkistettavat 2 avoinna" }).click();
  await expect(card(page).locator(".review-name")).toHaveText("Esimerkki Kauppa Oy");
  expect(seen.problems).toEqual([]);
  await context.close();
});
