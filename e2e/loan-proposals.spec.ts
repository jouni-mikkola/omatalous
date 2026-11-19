import { type Browser, type BrowserContext, expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// A loan proposal in Tarkistettavat: the demo household pays a car financing instalment every month, and the list of
// debts asks about it in a row of its own, with one field, what is left now. It is saved as a loan, with the balance typed in; removing the loan in
// Varat ja velat asks again, and then it is answered "En tiedä" (which keeps it away while the payment is the same) and "Ei ole velan maksu". The rows are the demo data of a household member made here and removed at the end, so the demo household of the other
// specs stays as it was. Every payee and sum here is made up.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const FETCH = { "X-Requested-With": "fetch" };
const PASSWORD = "ehdotus-testin-salasana-1";
/** Set by a run that wants pictures of the page: SHOTS_DIR=$TMPDIR/shots pnpm e2e e2e/loan-proposals.spec.ts */
const SHOTS = process.env.SHOTS_DIR;

/**
 * The administrator: signed in by e2e/run.mjs, and set up here through the API only on a server that has none.
 */
async function administrator(browser: Browser): Promise<BrowserContext> {
  if (existsSync(STATE)) return browser.newContext({ storageState: STATE });
  const context = await browser.newContext();
  const setup = await context.request.post("/api/auth/setup", { headers: FETCH, data: { code: process.env.E2E_SETUP_CODE, username: "aino", displayName: "Aino", password: "aino-salasana-123", confirm: "aino-salasana-123" } });
  expect(setup.status(), await setup.text()).toBe(200);
  expect((await context.request.post("/api/admin/instance/complete", { headers: FETCH })).status()).toBe(200);
  await context.storageState({ path: STATE });
  return context;
}

test("a payment that looks like a loan is asked in Tarkistettavat: saved as a loan with the balance typed in, and after the loan is removed answered Ei ole velan maksu", async ({ browser }) => {
  const admin = await administrator(browser);
  const created = await admin.request.post("/api/users", { headers: FETCH, data: { username: "ehdotus", displayName: "Ehdotus" } });
  expect(created.ok(), await created.text()).toBe(true);
  const { user, temporaryPassword } = await created.json();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    expect((await context.request.post("/api/auth/login", { headers: FETCH, data: { username: "ehdotus", password: temporaryPassword } })).status()).toBe(200);
    expect((await context.request.post("/api/auth/first-password", { headers: FETCH, data: { next: PASSWORD } })).status()).toBe(200);
    // nothing to ask about before the rows are there
    expect((await (await context.request.get("/api/loans/proposals")).json()).proposals).toEqual([]);
    expect((await context.request.post("/api/demo", { headers: FETCH })).status()).toBe(200);

    const page = await context.newPage();
    const seen = watch(page);
    const COMPANY = "Nordea Rahoitus Suomi Oy";
    const item = page.locator(".review-item");
    // the row of the proposal among the debts of the list, while it is asked, and once answered (the card's row has a name of its own)
    const row = item.locator("li.review-debt:not(.is-done)").filter({ has: page.locator(".review-debt-name", { hasText: /^Nordea Rahoitus Suomi Oy · / }) });
    const answered = item.locator("li.review-debt.is-done").filter({ has: page.locator(".review-debt-name", { hasText: /^Nordea Rahoitus Suomi Oy$/ }) });
    // the link of a missing balance opens the list of debts first
    const reach = async () => {
      await page.goto("/#/review?item=loan-terms");
      await page.reload();
      await expect(item.getByRole("heading", { level: 2 })).toContainText("Täydennä lainat", { timeout: 15_000 });
      await expect(row).toBeVisible();
    };
    type Debt = { source: string; name: string };
    const queued = async () => ((await (await context.request.get("/api/review")).json()).items as { kind: string; debts?: Debt[] }[]).flatMap((i) => (i.kind === "loan_terms_list" ? i.debts! : [])).filter((d) => d.source === "proposal" && d.name === COMPANY);

    // the demo household has one such payment, a row of the list with what its rows tell in the heading
    expect((await (await context.request.get("/api/loans/proposals")).json()).proposals).toHaveLength(1);
    expect(await queued()).toHaveLength(1);
    await reach();
    // a car financing by its words: the kind is known and not asked
    await expect(row.locator(".review-debt-name")).toHaveText(/^Nordea Rahoitus Suomi Oy · Autolaina · 289,00\s€\/kk$/);
    await expect(row.getByRole("group", { name: "Laji" })).toHaveCount(0);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, "tr1-proposal-390.png"), fullPage: true });

    // the row asks one thing, what is left now, with three answers and no line of help
    const form = row.locator(".review-field");
    await expect(row.locator(".loan-field")).toHaveCount(1);
    await expect(row.locator(".review-note, .field-help")).toHaveCount(0);
    const balance = form.getByLabel("Jäljellä nyt (€)");
    await expect(balance).toHaveValue("");
    for (const label of ["Korko (%)", "Viitekorko", "Marginaali (%)", "Miten erä muuttuu", "Lainan määrä (€)", "Lainanantaja"]) await expect(row.getByLabel(label, { exact: true })).toHaveCount(0);
    await expect(row.getByRole("button", { name: "En tiedä", exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "Ei ole velan maksu", exact: true })).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(1);

    // the balance is the household's to type: without it nothing is saved
    await form.getByRole("button", { name: "Tallenna", exact: true }).click();
    await expect(form.getByRole("alert")).toHaveText("Anna, paljonko lainaa on jäljellä.");
    expect((await (await context.request.get("/api/loans")).json()).loans).toEqual([]);

    // the same row at the width of a desktop, saved with the balance typed: the loan is linked to its payments and the row
    // closes into what was saved, with the list still shown
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await balance.fill("6 400,50");
    if (SHOTS) await page.screenshot({ path: join(SHOTS, "tr1-proposal-form-1280.png"), fullPage: true });
    await form.getByRole("button", { name: "Tallenna", exact: true }).click();
    await expect(answered.locator(".review-debt-result")).toHaveText(/^Jäljellä 6\s400,50\s€/);
    await expect(row).toHaveCount(0);
    await expect(item.getByRole("heading", { level: 2 })).toContainText("Täydennä lainat");
    const { loans } = await (await context.request.get("/api/loans")).json();
    expect(loans).toHaveLength(1);
    expect(loans[0]).toMatchObject({ kind: "car", lender: COMPANY, balanceCents: 640_050, rateBp: null, paymentCents: 28_900, intervalMonths: 1, repayment: "fixed_instalment" });
    // the balance typed is the balance of today
    expect(loans[0].balanceDate).toBe((await (await context.request.get("/api/meta")).json()).today);
    expect(loans[0].seriesKey).toMatch(/^out:.+:Nordea Rahoitus Suomi Oy#28900$/);
    expect((await (await context.request.get("/api/loans/proposals")).json()).proposals).toEqual([]);
    expect(await queued()).toEqual([]);

    // removing the loan in Varat ja velat > Lainat asks again: the payments are still there
    await page.goto("/#/reports?q=saldot");
    const card = page.locator("#lainat");
    const name = `Autolaina, ${COMPANY}`;
    await card.getByRole("button", { name, exact: true }).click();
    await card.getByRole("button", { name: `Muokkaa lainaa ${name}` }).click();
    const editor = page.getByRole("dialog", { name: "Muokkaa lainaa" });
    await expect(editor.getByLabel("Lainaa jäljellä (€)")).toHaveValue("6 400,50");
    await editor.getByRole("button", { name: "Peruuta" }).click();
    await card.getByRole("button", { name: `Poista laina ${name}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Poista laina", exact: true }).click();
    await expect(page.locator("#saldot").getByRole("status").filter({ hasText: "Laina poistettu" })).toHaveText("Laina poistettu");
    // the saved loan is gone; the payments are a debt nobody told the balance of, with nothing to change in Lainat
    await expect(page.getByRole("heading", { name: "Tunnistettu, saldo puuttuu" })).toHaveCount(0);
    await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^(Poista laina|Muokkaa lainaa) / })).toHaveCount(0);
    expect(await queued()).toHaveLength(1);

    // En tiedä: the row closes at once and stays away while the payment is the same
    await reach();
    await row.getByRole("button", { name: "En tiedä", exact: true }).click();
    await expect(answered.locator(".review-debt-result")).toHaveText("En tiedä");
    expect(await queued()).toEqual([]);
    const unknown = ((await (await context.request.get("/api/recurring")).json()).marks as { subject: string; mark: string }[]).filter((m) => m.subject.startsWith("question:loan-unknown:"));
    expect(unknown.map((m) => [m.subject.replace(/:out:[^:]+:/, ":out:<account>:"), m.mark])).toEqual([["question:loan-unknown:28900:out:<account>:Nordea Rahoitus Suomi Oy#28900", "in_use"]]);
    // taken back, it asks again
    expect((await context.request.put("/api/marks", { headers: FETCH, data: { subject: unknown[0]!.subject, mark: null } })).ok()).toBe(true);
    expect(await queued()).toHaveLength(1);

    // Ei ole velan maksu: the row closes at once, and the mark is stored under the subject of its own
    await reach();
    await row.getByRole("button", { name: "Ei ole velan maksu" }).click();
    await expect(answered.locator(".review-debt-result")).toHaveText("Ei ole velan maksu");
    const { marks } = await (await context.request.get("/api/recurring")).json();
    expect(marks.map((m: { subject: string; mark: string }) => [m.subject.replace(/^(loan-proposal:out:)[^:]+:/, "$1<account>:"), m.mark])).toContainEqual(["loan-proposal:out:<account>:Nordea Rahoitus Suomi Oy#28900", "dismissed"]);
    expect(await queued()).toEqual([]);
    expect(seen.problems).toEqual([]);
  } finally {
    await context.close();
    await admin.request.delete(`/api/users/${user.id}`, { headers: FETCH });
    await admin.close();
  }
});
