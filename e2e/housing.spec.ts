import { type Browser, type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";
import { join } from "node:path";
import { cents, columnLine, linkFakeBank, makeMember, overflow, plain, removeMember, sayJointUse, setScope, waitForSync, watch } from "./helpers.ts";

// The block Asuminen of Yhteenveto. The demo household of the administrator (e2e/run.mjs made it) pays rent and electricity, so
// it is a tenant's; a loan saved here gives it a mortgage's row and goes at the end. The question about a home loan needs a
// household that is no tenant: two members who link the fake bank (e2e/fake-bank/) have electricity and a joint account whose
// payments no category calls a mortgage. They are made here and go at the end.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const FETCH = { "X-Requested-With": "fetch" };
const NAMES = ["e2e-asuminen-a", "e2e-asuminen-b"] as const;
const DASH = "–";

interface Member {
  state: string;
  id: string;
}
const members: Member[] = [];
let adminLoanId = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  for (const name of NAMES) {
    const member = await makeMember(browser, name);
    members.push(member);
    const context = await browser.newContext({ storageState: member.state });
    await linkFakeBank(await context.newPage());
    await waitForSync(context);
    await context.close();
  }
  // the first partner says who uses the joint account, as Asetukset > Tilit does; both copies are one real account
  const first = await browser.newContext({ storageState: members[0]!.state });
  await sayJointUse(first, members.map((m, i) => ({ userId: m.id, weight: [6000, 4000][i]! })));
  await first.close();
});
test.afterAll(async ({ browser }) => {
  const admin = await browser.newContext({ storageState: STATE });
  if (adminLoanId) await admin.request.delete(`/api/loans/${adminLoanId}`, { headers: FETCH });
  await admin.close();
  for (const member of members) await removeMember(browser, member.id);
});

async function open(browser: Browser, state: string, path: string, options: { width?: number; scope?: { id: string; choice: "own" | "household" } } = {}) {
  const context = await browser.newContext({ storageState: state, viewport: { width: options.width ?? 1280, height: 900 } });
  if (options.scope) await setScope(context, options.scope.id, options.scope.choice);
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto(path);
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  return { context, page, seen };
}

/** The block: the only region of that name on Yhteenveto. */
const blockOf = (page: Page) => page.getByRole("region", { name: "Asuminen", exact: true });
/** The two tables. Below 1040 px Lainat is drawn as pairs and is no table to a reader, so both are found by their class. */
const loansOf = (block: Locator) => block.locator(".housing-loans");
const chargesOf = (block: Locator) => block.locator(".housing-charges");
const loanRows = (block: Locator) => loansOf(block).locator("tbody tr");
/** A cell of a loan's row by its column, as it reads: the value, without the label a narrow screen draws before it. */
const cell = async (row: Locator, column: string) => plain(await row.locator(`.housing-${column} > span`).last().innerText());
/** The rows of the charges as they read: the kind (with the line under it), the payee, the month in cents. */
const chargeRows = async (block: Locator) =>
  Promise.all((await chargesOf(block).locator("tbody tr").all()).map(async (row) => [plain(await row.locator("td").nth(0).innerText()), plain(await row.locator("td").nth(1).innerText()), cents(await row.locator(".st-num").innerText())] as const));
/** The sums of the block by their labels, in cents. */
const sumsOf = async (block: Locator): Promise<Record<string, number>> =>
  Object.fromEntries(await Promise.all((await block.locator(".housing-sums .st-row").all()).map(async (row) => [plain(await row.locator(".st-name").innerText()), cents(await row.locator(".st-num").innerText())] as const)));
/** The question's row: its name, the link and the button. */
const question = (block: Locator) => block.locator(".housing-ask");
const addLink = (block: Locator) => block.getByRole("link", { name: "Lisää asuntolaina", exact: true });
const answerButton = (block: Locator) => block.getByRole("button", { name: "Ei asuntolainaa", exact: true });
/** The sentences the block told before it was a statement: none of them is on the page. */
const SENTENCES = ["Yhteisen tilin maksuista näkyy osuutesi.", "Asuntolainaa ei ole lisätty.", "Lainan tiedot puuttuvat.", "Korko ei ole tiedossa.", "Ilman lainan maksuerää"];

const ANSWER = { subject: "question:mortgage", mark: "dismissed" };

test("a tenant's block: the rent and the electricity as the table Asumiskulut, one total, no table of loans and no question", async ({ browser }) => {
  const { context, page, seen } = await open(browser, STATE, "/#/overview");
  const block = blockOf(page);
  await expect(block.getByRole("heading", { level: 2 })).toHaveText("Asuminen");
  await expect(block.getByRole("table", { name: "Asumiskulut", exact: true })).toBeVisible();
  expect(await chargesOf(block).locator("thead th").allInnerTexts()).toEqual(["Kulu", "Saaja", "Kuukaudessa"]);
  const rows = await chargeRows(block);
  expect(rows.map((r) => [r[0], r[1]]), "the rent is the larger, so it comes first").toEqual([["Vuokra", "Sato Oyj"], ["Sähkö", "Helen"]]);
  await expect(block.getByRole("link", { name: "Sato Oyj" })).toHaveAttribute("href", "#/transactions?merchant=Sato+Oyj");
  await expect(block.getByRole("link", { name: "Helen" })).toHaveAttribute("href", "#/transactions?merchant=Helen");

  // only charges: the total alone, and it is the rows' sum
  expect(rows[0]![2]).toBeGreaterThan(rows[1]![2]);
  expect(await sumsOf(block)).toEqual({ "Asuminen yhteensä kuukaudessa": rows[0]![2] + rows[1]![2] });
  await expect(block.locator(".housing-sums .st-total")).toHaveCount(1);

  // a tenant has no loan to list and no home loan to add
  await expect(loansOf(block)).toHaveCount(0);
  await expect(question(block)).toHaveCount(0);
  for (const sentence of SENTENCES) await expect(block.getByText(sentence)).toHaveCount(0);

  // the block is the width of the page, under Erääntyvät maksut and on its edges
  const mine = (await block.boundingBox())!;
  const due = (await page.getByRole("region", { name: "Erääntyvät maksut", exact: true }).boundingBox())!;
  expect([mine.x, mine.width]).toEqual([due.x, due.width]);
  expect(mine.y).toBeGreaterThanOrEqual(due.y + due.height);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a saved mortgage is a row of the table Lainat with its terms and its next payment in their columns, and the three sums add up; its name opens Lainat of Raportit", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const today = (await (await context.request.get("/api/meta")).json()).today as string;
  const review = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
  // the last due date is typed: only then is the next payment's day the plan's (a loan without one takes the day of its series)
  const last = `${Number(today.slice(0, 4)) + 15}${today.slice(4)}`;
  const saved = await context.request.post("/api/loans", {
    headers: FETCH,
    data: {
      name: "Kodin laina", lender: "Esimerkkirahoitus Oy", kind: "mortgage", grantedCents: 15_000_000, balanceCents: 12_000_000, balanceDate: today, rateBp: 400, reference: "euribor_12", marginBp: 60,
      repayment: "annuity", intervalMonths: 1, paymentCents: 100_000, endDate: last, limitCents: null, seriesKey: null, rateReviewDate: review,
    },
  });
  expect(saved.ok(), `POST /api/loans answered ${saved.status()}: ${await saved.text()}`).toBe(true);
  adminLoanId = (await saved.json()).loan.id;
  await context.close();

  const { context: shown, page, seen } = await open(browser, STATE, "/#/overview");
  const block = blockOf(page);
  const table = block.getByRole("table", { name: "Lainat", exact: true });
  await expect(table).toBeVisible();
  // the heads: the loan and its terms, the three of the next payment under their group, the month last
  expect(await table.locator("thead tr").nth(0).locator("th").allInnerTexts()).toEqual(["Laina", "Korko", "Viitekorko ja marginaali", "Koron tarkistuspäivä", "Seuraava maksuerä", "Kuukaudessa"]);
  expect(await table.locator("thead tr").nth(1).locator("th").allInnerTexts()).toEqual(["Eräpäivä", "Lyhennys", "Korko"]);
  await expect(loanRows(block)).toHaveCount(1);
  const loan = loanRows(block).first();
  await expect(loan.locator(".housing-name a")).toHaveText("Kodin laina");
  expect(await loan.locator(".housing-name .st-sub").allInnerTexts(), "the lender is the line under the name").toEqual(["Esimerkkirahoitus Oy"]);
  const [y, m, d] = review.split("-").map(Number);
  expect(await cell(loan, "rate")).toBe("4,00 %");
  expect(await cell(loan, "reference")).toBe("12 kuukauden Euribor 3,40 % + 0,60 %");
  expect(await cell(loan, "review")).toBe(`${d}.${m}.${y}`);
  expect(await cell(loan, "due")).toMatch(/^\d{1,2}\.\d{1,2}\.$/);
  // the two parts of the next payment are the payment of the month
  const [amortisation, interest, month] = [cents(await cell(loan, "amortisation")), cents(await cell(loan, "interest")), cents(await cell(loan, "month"))];
  expect([amortisation + interest, month]).toEqual([100_000, 100_000]);
  // every term is typed: no dash in the row, and no link to add one
  expect(plain(await loan.innerText())).not.toContain(DASH);
  await expect(block.getByRole("link", { name: "Täydennä" })).toHaveCount(0);
  await expect(loan.locator(".housing-label").first()).toBeHidden();

  // the charges stay under the table, and the three sums are the rows' own
  const charges = await chargeRows(block);
  expect(charges.map((r) => r[0])).toEqual(["Vuokra", "Sähkö"]);
  const paid = charges[0]![2] + charges[1]![2];
  expect(await sumsOf(block)).toEqual({ "Lainojen maksuerät": month, Asumiskulut: paid, "Asuminen yhteensä kuukaudessa": month + paid });
  await expect(block.getByText(/Summasta puuttuu/)).toHaveCount(0);
  for (const sentence of SENTENCES) await expect(block.getByText(sentence)).toHaveCount(0);

  // the sums are the block's last four columns: the charges end where they begin
  const [left, right] = [(await chargesOf(block).boundingBox())!, (await block.locator(".housing-sums").boundingBox())!];
  expect(left.x + left.width).toBeLessThan(right.x);
  const card = (await block.boundingBox())!;
  expect(Math.abs(right.x - 20 - (await columnLine(page, card, 8))), "the sums start on the page's column line").toBeLessThanOrEqual(2);

  // the name opens the loans of Raportit
  await block.getByRole("link", { name: "Kodin laina" }).click();
  await expect(page).toHaveURL(/#\/reports#lainat$/);
  await expect(page.locator("#lainat").getByRole("heading", { name: "Lainat" })).toBeVisible();
  expect(seen.problems).toEqual([]);
  await shown.close();
});

test("the table Lainat fits the card at 1040 px, where it is narrowest, and under it a loan is label and value pairs: two a row at 700 px, one at 390", async ({ browser }) => {
  for (const width of [1040, 700, 390]) {
    const { context, page, seen } = await open(browser, STATE, "/#/overview", { width });
    const block = blockOf(page);
    await expect(block.getByRole("link", { name: "Kodin laina" })).toBeVisible();
    expect(await overflow(page), `Yhteenveto scrolls sideways at ${width} px`).toBeLessThanOrEqual(1);
    const card = (await block.boundingBox())!;
    for (const box of await block.locator("th, td, .st-row").evaluateAll((els) => els.filter((el) => el.getClientRects().length > 0).map((el) => el.getBoundingClientRect().toJSON()))) {
      expect(box.left, `a cell stays inside the card at ${width} px`).toBeGreaterThanOrEqual(card.x);
      expect(box.right, `a cell stays inside the card at ${width} px`).toBeLessThanOrEqual(card.x + card.width + 1);
    }
    const loan = loanRows(block).first();
    const label = loan.locator(".housing-reference .housing-label");
    const group = loan.locator(".housing-group");
    if (width >= 1040) {
      // a table: the heads name the columns, so no cell repeats its label
      await expect(loansOf(block).locator("thead")).toBeVisible();
      await expect(label).toBeHidden();
      await expect(group).toBeHidden();
    } else {
      // pairs: the same labels as the heads, each before its value, the next payment under its own head
      await expect(loansOf(block).locator("thead")).toBeHidden();
      await expect(label).toHaveText("Viitekorko ja marginaali");
      await expect(group).toHaveText("Seuraava maksuerä");
      expect(await loan.locator(".housing-label").allInnerTexts()).toEqual(["Korko", "Viitekorko ja marginaali", "Koron tarkistuspäivä", "Eräpäivä", "Lyhennys", "Korko", "Kuukaudessa"]);
      const [rate, due] = [(await loan.locator(".housing-rate").boundingBox())!, (await group.boundingBox())!];
      if (width >= 600) expect(Math.abs(rate.y - due.y), "two pairs a row").toBeLessThanOrEqual(1);
      else expect(due.y, "one pair a row: the next payment is under the terms").toBeGreaterThan((await loan.locator(".housing-month").boundingBox())!.y);
    }
    expect(seen.problems).toEqual([]);
    await context.close();
  }
});

test("at 390 px the question's buttons wrap under its name, and nothing scrolls sideways", async ({ browser }) => {
  const { context, page, seen } = await open(browser, members[0]!.state, "/#/overview", { width: 390 });
  const block = blockOf(page);
  await expect(question(block)).toBeVisible();
  expect(await overflow(page), "Yhteenveto scrolls sideways at 390 px").toBeLessThanOrEqual(1);
  const card = (await block.boundingBox())!;
  for (const control of [addLink(block), answerButton(block)]) {
    const box = (await control.boundingBox())!;
    expect(box.x + box.width, "a control stays inside the card").toBeLessThanOrEqual(card.x + card.width);
  }
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a household with a charge and no home loan is asked in one row, Asuntolaina at the left and the two buttons at the right, and the link lands on the card Lainat of Asetukset", async ({ browser }) => {
  const { context, page, seen } = await open(browser, members[0]!.state, "/#/overview");
  const block = blockOf(page);
  // the electricity is the one charge: the total alone, and no table of loans
  expect((await chargeRows(block)).map((r) => r[0])).toEqual(["Sähkö"]);
  expect(Object.keys(await sumsOf(block))).toEqual(["Asuminen yhteensä kuukaudessa"]);
  await expect(loansOf(block)).toHaveCount(0);
  await expect(question(block)).toBeVisible();
  expect(plain(await question(block).innerText())).toBe("Asuntolaina Lisää asuntolaina Ei asuntolainaa");
  await expect(addLink(block)).toHaveAttribute("href", "#/settings#lainat");
  await expect(answerButton(block)).toBeEnabled();
  // one row: the name, then the buttons, the last one ending on the block's right edge
  const [name, add, no] = await Promise.all([question(block).locator(".st-name"), addLink(block), answerButton(block)].map(async (l) => (await l.boundingBox())!));
  expect(name!.x).toBeLessThan(add!.x);
  expect(add!.x + add!.width).toBeLessThan(no!.x);
  expect(Math.abs(add!.y - no!.y)).toBeLessThanOrEqual(1);
  const card = (await block.boundingBox())!;
  expect(Math.abs(no!.x + no!.width - (card.x + card.width - 20)), "the last button ends where the block's figures end").toBeLessThanOrEqual(2);
  for (const sentence of SENTENCES) await expect(block.getByText(sentence)).toHaveCount(0);

  await addLink(block).click();
  await expect(page).toHaveURL(/#\/settings#lainat$/);
  const lainat = page.locator("#lainat");
  await expect(lainat.getByRole("heading", { name: "Lainat", exact: true })).toBeVisible();
  await expect(lainat).toBeInViewport();
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("Ei asuntolainaa saves the answer, disables the button while it is on its way, and the question stays away after a reload", async ({ browser }) => {
  const { context, page, seen } = await open(browser, members[0]!.state, "/#/overview");
  const block = blockOf(page);
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/api\/marks$/, async (route) => {
    if (route.request().method() === "PUT") await held;
    await route.continue().catch(() => {});
  });
  const sent = page.waitForRequest((r) => r.url().endsWith("/api/marks") && r.method() === "PUT");
  await answerButton(block).click();
  expect((await sent).postDataJSON()).toEqual(ANSWER);
  await expect(answerButton(block)).toBeDisabled();
  release();
  // the question is gone and the charge stays
  await expect(question(block)).toHaveCount(0);
  await expect(addLink(block)).toHaveCount(0);
  expect((await chargeRows(block)).map((r) => r[0])).toEqual(["Sähkö"]);
  await page.reload();
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  await expect(blockOf(page).getByRole("heading", { level: 2 })).toHaveText("Asuminen");
  await expect(question(blockOf(page))).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("the answer is the member's own: the other member is asked still, and when the answer is not saved the row says so and stays", async ({ browser }) => {
  // the 500 below is the point of the test, so only it may be a problem
  const { context, page, seen } = await open(browser, members[1]!.state, "/#/overview");
  const block = blockOf(page);
  await expect(question(block)).toBeVisible();
  await page.route(/\/api\/marks$/, (route) => (route.request().method() === "PUT" ? route.fulfill({ status: 500, json: { error: "Palvelinvirhe." } }) : route.continue()));
  await answerButton(block).click();
  await expect(block.getByRole("alert")).toHaveText("Tallennus ei onnistunut.");
  await expect(question(block)).toBeVisible();
  await expect(answerButton(block)).toBeEnabled();
  expect(seen.problems.every((p) => /500|Failed to load resource/.test(p))).toBe(true);
  // the marks of the member are untouched by the first member's answer
  const marks = (await (await context.request.get("/api/recurring")).json()).marks as { subject: string }[];
  expect(marks.some((x) => x.subject === ANSWER.subject)).toBe(false);
  await context.close();
});

test("with nothing of a home left the block is the heading and the question alone, and answering it removes the block, after a reload too", async ({ browser }) => {
  const { context, page } = await open(browser, members[1]!.state, "/#/overview");
  // the electricity is called cancelled, as the marks route takes it: nothing of a home is known
  const housing = (await (await context.request.get("/api/dashboard")).json()).housing as { charges: { seriesId: string }[] };
  for (const charge of housing.charges) {
    const marked = await context.request.put("/api/marks", { headers: FETCH, data: { subject: `series:${charge.seriesId}`, mark: "cancelled" } });
    expect(marked.ok(), `PUT /api/marks answered ${marked.status()}`).toBe(true);
  }
  await page.reload();
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  const block = blockOf(page);
  await expect(block.getByRole("heading", { level: 2 })).toHaveText("Asuminen");
  await expect(question(block)).toBeVisible();
  // no table and no sum: a block with nothing to add up does not print a zero
  await expect(block.locator("table")).toHaveCount(0);
  await expect(block.locator(".housing-sums")).toHaveCount(0);

  await answerButton(block).click();
  await expect(blockOf(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Varallisuus", exact: true })).toBeVisible();
  await expect(blockOf(page)).toHaveCount(0);
  await context.close();
});

/** A mortgage the second member saves from what the joint account's payments propose, the way Asetukset > Lainat does. */
async function saveProposedMortgage(browser: Browser, state: string): Promise<void> {
  const context: BrowserContext = await browser.newContext({ storageState: state });
  const { proposals } = await (await context.request.get("/api/loans/proposals")).json();
  expect(proposals, "the joint account's payments are proposed as one loan").toHaveLength(1);
  const { today } = await (await context.request.get("/api/meta")).json();
  const saved = await context.request.post("/api/loans", {
    headers: FETCH,
    data: {
      name: "Asuntolaina", lender: proposals[0].payee, kind: "mortgage", grantedCents: 15_000_000, balanceCents: 12_000_000, balanceDate: today, rateBp: 400, reference: null,
      marginBp: null, repayment: "annuity", intervalMonths: 1, paymentCents: proposals[0].paymentCents, endDate: null, limitCents: null, seriesKey: proposals[0].key,
    },
  });
  expect(saved.ok(), `POST /api/loans answered ${saved.status()}: ${await saved.text()}`).toBe(true);
  await context.close();
}

test("a loan paid from a joint account is the member's part with the line that says so and the whole in Koko talous; its missing terms are dashes, and only the member who typed it is offered Täydennä", async ({ browser }) => {
  await saveProposedMortgage(browser, members[1]!.state);
  const [first, second] = members as [Member, Member];
  const own = await open(browser, first.state, "/#/overview", { scope: { id: first.id, choice: "own" } });
  const ownBlock = blockOf(own.page);
  // the loan the partner saved is a row with the rate it was typed with and a dash for the terms it lacks; no question is asked
  await expect(loanRows(ownBlock)).toHaveCount(1);
  const mine = loanRows(ownBlock).first();
  await expect(mine.locator(".housing-name a")).toHaveText("Asuntolaina");
  await expect(question(ownBlock)).toHaveCount(0);
  expect([await cell(mine, "rate"), await cell(mine, "reference"), await cell(mine, "review")]).toEqual(["4,00 %", DASH, DASH]);
  expect((await mine.locator(".housing-name .st-sub").allInnerTexts()).map(plain), "the part is a line under the name, as on an account's row").toContain("osuutesi 60 %");
  // the loan is its typist's to change: no link on the row, and no column for one
  await expect(ownBlock.getByRole("link", { name: "Täydennä" })).toHaveCount(0);
  await expect(mine.locator(".housing-link")).toHaveCount(0);
  const part = cents(await cell(mine, "month"));
  const power = (await chargeRows(ownBlock))[0]![2];
  expect(await sumsOf(ownBlock), "the sums hold the part").toEqual({ "Lainojen maksuerät": part, Asumiskulut: power, "Asuminen yhteensä kuukaudessa": part + power });
  for (const sentence of SENTENCES) await expect(ownBlock.getByText(sentence)).toHaveCount(0);
  expect(own.seen.problems).toEqual([]);
  await own.context.close();

  const whole = await open(browser, first.state, "/#/overview", { scope: { id: first.id, choice: "household" } });
  const wholeBlock = blockOf(whole.page);
  const all = cents(await cell(loanRows(wholeBlock).first(), "month"));
  // 60 % of what the joint account pays, and the whole of it in Koko talous, where no row is a part
  expect(part).toBe(Math.round(all * 0.6));
  expect(all).toBeGreaterThan(part);
  await expect(wholeBlock.getByText(/osuutesi/)).toHaveCount(0);
  await expect(wholeBlock.getByRole("link", { name: "Täydennä" })).toHaveCount(0);
  expect((await sumsOf(wholeBlock))["Asuminen yhteensä kuukaudessa"]).toBe(all + power);
  expect(whole.seen.problems).toEqual([]);
  await whole.context.close();

  // the member who typed the loan sees the same dashes, and the one link that mends them
  const typist = await open(browser, second.state, "/#/overview", { scope: { id: second.id, choice: "own" } });
  const typed = loanRows(blockOf(typist.page)).first();
  expect([await cell(typed, "reference"), await cell(typed, "review")]).toEqual([DASH, DASH]);
  expect((await typed.locator(".housing-name .st-sub").allInnerTexts()).map(plain)).toContain("osuutesi 40 %");
  await expect(typed.locator(".housing-link").getByRole("link", { name: "Täydennä", exact: true })).toHaveAttribute("href", "#/settings#lainat");
  expect(typist.seen.problems).toEqual([]);
  await typist.context.close();
});
