import { type Browser, type BrowserContext, expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// A loan proposal in Tarkistettavat: the demo household pays a car financing instalment every month, and the page asks
// about it. It is saved as a loan, with the balance typed in; removing the loan in Asetukset > Lainat asks again, and then
// it is answered "Ei laina". The
// rows are the demo data of a household member made here and removed at the end, so the demo household of the other
// specs stays as it was. Every payee and sum here is made up.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const FETCH = { "X-Requested-With": "fetch" };
const PASSWORD = "ehdotus-testin-salasana-1";
/** Set by a run that wants pictures of the page: SHOTS_DIR=/tmp/claude-0/shots pnpm e2e e2e/loan-proposals.spec.ts */
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

test("a payment that looks like a loan is asked in Tarkistettavat: saved as a loan with the balance typed in, and after the loan is removed answered Ei laina", async ({ browser }) => {
  const admin = await administrator(browser);
  const created = await admin.request.post("/api/users", { headers: FETCH, data: { username: "ehdotus", displayName: "Ehdotus" } });
  expect(created.ok(), await created.text()).toBe(true);
  const { user, temporaryPassword } = await created.json();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    expect((await context.request.post("/api/auth/login", { headers: FETCH, data: { username: "ehdotus", password: temporaryPassword } })).status()).toBe(200);
    expect((await context.request.post("/api/auth/password", { headers: FETCH, data: { current: temporaryPassword, next: PASSWORD } })).status()).toBe(200);
    // nothing to ask about before the rows are there
    expect((await (await context.request.get("/api/loans/proposals")).json()).proposals).toEqual([]);
    expect((await context.request.post("/api/demo", { headers: FETCH })).status()).toBe(200);

    const page = await context.newPage();
    const seen = watch(page);
    const COMPANY = "Nordea Rahoitus Suomi Oy";
    const item = page.locator(".review-item");
    const name = item.locator(".review-name");
    // the queue is ordered by money: Ohita moves on until the proposal is the item shown
    const reach = async () => {
      await page.goto("/#/review");
      await page.reload();
      await expect(page.locator(".review-item, .review-end").first()).toBeVisible({ timeout: 15_000 });
      for (let n = 0; n < 25 && (await name.innerText()) !== COMPANY; n++) {
        const was = await name.innerText();
        await item.getByRole("button", { name: "Ohita" }).click();
        await expect(name).not.toHaveText(was);
      }
      await expect(name).toHaveText(COMPANY);
    };
    const queued = async () => ((await (await context.request.get("/api/review")).json()).items as { kind: string; payee?: string }[]).filter((i) => i.kind === "loan" && i.payee === COMPANY);

    // the demo household has one such payment, asked in Tarkistettavat with the sum and a question a neighbour would ask
    expect((await (await context.request.get("/api/loans/proposals")).json()).proposals).toHaveLength(1);
    expect(await queued()).toHaveLength(1);
    await reach();
    // every loan is asked one way: its kinds, the one its rows suggest first and named
    await expect(item.getByRole("heading", { name: "Mikä laina tämä on?" })).toBeVisible();
    await expect(item.locator(".review-choice").first()).toHaveAccessibleName("Autolaina Ehdotus");
    // the rows are the loan's own: every one is the instalment, none of the bank's other payments
    await expect(item.locator(".review-row-sum")).not.toHaveCount(0);
    for (const sum of await item.locator(".review-row-sum").allInnerTexts()) expect(sum.replace(/\s/g, " ")).toBe("−289,00 €");
    await expect(item.locator(".review-figure")).toHaveText(/289,00\s€\s?kuussa/);
    // Asetukset > Lainat asks nothing any more
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, "tr1-proposal-390.png"), fullPage: true });

    // Tallenna lainaksi: the form opens in the item with what the rows show, and asks for the rest
    await item.getByRole("button", { name: "Autolaina Ehdotus" }).click();
    const form = item.locator(".review-loan");
    await expect(form.getByLabel("Lainanantaja", { exact: true })).toHaveValue(COMPANY);
    await expect(form.getByLabel("Laji")).toHaveValue("car");
    await expect(form.getByLabel("Maksuerä (€)")).toHaveValue("289,00");
    await expect(form.getByLabel("Lyhennysväli", { exact: true })).toHaveValue("1");
    await expect(form.getByLabel("Lainaa jäljellä (€)")).toHaveValue("");
    await expect(form.getByLabel("Kokonaiskorko (%)")).toHaveValue("");
    expect(await overflow(page)).toBeLessThanOrEqual(1);

    // the balance is the household's to type: without it nothing is saved
    await form.getByRole("button", { name: "Tallenna", exact: true }).click();
    await expect(form.getByRole("alert")).toHaveText("Korjaa merkityt kentät.");
    await expect(form.getByText("Anna, paljonko lainaa on jäljellä.")).toBeVisible();
    expect((await (await context.request.get("/api/loans")).json()).loans).toEqual([]);
    // Peruuta closes the form and the question stays
    await form.getByRole("button", { name: "Peruuta" }).click();
    await expect(form).toHaveCount(0);
    await expect(name).toHaveText(COMPANY);

    // the same item at the width of a desktop, saved with the balance typed: the loan is linked to its payments and the next item shows
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await item.getByRole("button", { name: "Autolaina Ehdotus" }).click();
    await form.getByLabel("Lainaa jäljellä (€)").fill("6 400,50");
    await form.getByLabel("Kokonaiskorko (%)").fill("7,90");
    if (SHOTS) await page.screenshot({ path: join(SHOTS, "tr1-proposal-form-1280.png"), fullPage: true });
    await form.getByRole("button", { name: "Tallenna", exact: true }).click();
    await expect(name).not.toHaveText(COMPANY);
    const { loans } = await (await context.request.get("/api/loans")).json();
    expect(loans).toHaveLength(1);
    expect(loans[0]).toMatchObject({ kind: "car", lender: COMPANY, balanceCents: 640_050, rateBp: 790, paymentCents: 28_900, intervalMonths: 1 });
    expect(loans[0].seriesKey).toMatch(/^out:.+:Nordea Rahoitus Suomi Oy#28900$/);
    expect((await (await context.request.get("/api/loans/proposals")).json()).proposals).toEqual([]);
    expect(await queued()).toEqual([]);

    // removing the loan in Asetukset > Lainat asks again: the payments are still there
    await page.goto("/#/settings");
    const card = page.locator("#lainat");
    const saved = card.getByRole("row").filter({ hasText: `Autolaina, ${COMPANY}` });
    await expect(saved).toContainText(/6\s400,50\s€/);
    await saved.getByRole("button", { name: /Poista laina/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Poista", exact: true }).click();
    await expect(card.getByRole("status").filter({ hasText: "Laina poistettu." })).toBeVisible();
    await expect(card.getByRole("heading", { name: "Mahdolliset lainat" })).toHaveCount(0);
    expect(await queued()).toHaveLength(1);

    // Ei laina: the item goes at once, and the mark is stored under the subject of its own
    await reach();
    await item.getByRole("button", { name: "Ei laina" }).click();
    await expect(name).not.toHaveText(COMPANY);
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
