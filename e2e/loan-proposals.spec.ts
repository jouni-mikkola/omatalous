import { type Browser, type BrowserContext, expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// Asetukset > Lainat: the demo household pays a car financing instalment every month, and the page asks about it. It is
// saved as a loan, with the balance typed in; removing the loan asks again, and then it is answered "Ei laina". The
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

test("a payment that looks like a loan is asked about: saved as a loan with the balance typed in, and after the loan is removed answered Ei laina", async ({ browser }) => {
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
    await page.goto("/#/settings");
    const card = page.locator("#lainat");
    const title = card.getByRole("heading", { name: "Mahdolliset lainat" });
    const company = card.getByRole("row").filter({ hasText: "Nordea Rahoitus Suomi Oy" });

    // the block is above the list, with the payee, the sum and a question a neighbour would ask
    await expect(title).toBeVisible();
    await expect(card.getByText("Onko tämä lainan maksu?")).toBeVisible();
    await expect(company).toContainText(/289,00\s€ kuukaudessa/);
    // the demo household has one such payment
    expect((await (await context.request.get("/api/loans/proposals")).json()).proposals).toHaveLength(1);
    // the block holds no sentence about changing an answer
    await expect(card.getByText("Jos vastasit vahingossa Ei laina, lisää laina itse alempana.")).toHaveCount(0);
    // no count, badge or alert anywhere else: the nav and the overview say nothing about it
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    if (SHOTS) await card.screenshot({ path: join(SHOTS, "ln8-proposals-390.png") });

    // Tallenna lainaksi: the form opens under the row with what the rows show, and asks for the rest
    await card.getByRole("button", { name: "Tallenna lainaksi: Nordea Rahoitus Suomi Oy" }).click();
    const form = card.getByRole("region", { name: "Tallenna laina: Nordea Rahoitus Suomi Oy" });
    await expect(form.getByLabel("Lainanantaja", { exact: true })).toHaveValue("Nordea Rahoitus Suomi Oy");
    await expect(form.getByLabel("Laji")).toHaveValue("car");
    await expect(form.getByLabel("Maksuerä (€)")).toHaveValue("289,00");
    await expect(form.getByLabel("Lyhennysväli", { exact: true })).toHaveValue("1");
    await expect(form.getByLabel("Lainaa jäljellä (€)")).toHaveValue("");
    await expect(form.getByLabel("Kokonaiskorko (%)")).toHaveValue("");
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    if (SHOTS) await card.screenshot({ path: join(SHOTS, "ln8-form-390.png") });

    // the balance is the household's to type: without it nothing is saved
    await form.getByRole("button", { name: "Tallenna", exact: true }).click();
    await expect(form.getByRole("alert")).toHaveText("Korjaa merkityt kentät.");
    await expect(form.getByText("Anna, paljonko lainaa on jäljellä.")).toBeVisible();
    expect((await (await context.request.get("/api/loans")).json()).loans).toEqual([]);
    // Peruuta closes the form and the proposal stays
    await form.getByRole("button", { name: "Peruuta" }).click();
    await expect(form).toHaveCount(0);
    await expect(company).toBeVisible();

    // the same page at the width of a desktop
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(title).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    if (SHOTS) await card.screenshot({ path: join(SHOTS, "ln8-proposals-1280.png") });

    // Tallenna lainaksi with the balance typed: the loan is saved, linked to its payments, and the proposal is gone
    await card.getByRole("button", { name: "Tallenna lainaksi: Nordea Rahoitus Suomi Oy" }).click();
    await form.getByLabel("Lainaa jäljellä (€)").fill("6 400,50");
    await form.getByLabel("Kokonaiskorko (%)").fill("7,90");
    if (SHOTS) await card.screenshot({ path: join(SHOTS, "ln8-form-1280.png") });
    await form.getByRole("button", { name: "Tallenna", exact: true }).click();
    await expect(card.getByRole("status").filter({ hasText: "Autolaina, Nordea Rahoitus Suomi Oy tallennettu." })).toBeVisible();
    await expect(title).toHaveCount(0);
    const saved = card.getByRole("row").filter({ hasText: "Autolaina, Nordea Rahoitus Suomi Oy" });
    await expect(saved).toContainText(/6\s400,50\s€/);
    await expect(saved).toContainText(/289,00\s€/);
    const { loans } = await (await context.request.get("/api/loans")).json();
    expect(loans).toHaveLength(1);
    expect(loans[0]).toMatchObject({ kind: "car", lender: "Nordea Rahoitus Suomi Oy", balanceCents: 640_050, rateBp: 790, paymentCents: 28_900, intervalMonths: 1 });
    expect(loans[0].seriesKey).toMatch(/^out:.+:Nordea Rahoitus Suomi Oy#28900$/);
    expect((await (await context.request.get("/api/loans/proposals")).json()).proposals).toEqual([]);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    if (SHOTS) await card.screenshot({ path: join(SHOTS, "ln8-saved-1280.png") });

    // removing the loan asks again: the payments are still there
    await saved.getByRole("button", { name: /Poista laina/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Poista", exact: true }).click();
    await expect(card.getByRole("status").filter({ hasText: "Laina poistettu." })).toBeVisible();
    await expect(title).toBeVisible();
    await expect(company).toBeVisible();

    // Ei laina: the row goes at once, and the mark is stored under the subject of its own
    await card.getByRole("button", { name: "Ei laina: Nordea Rahoitus Suomi Oy" }).click();
    await expect(card.getByRole("status").filter({ hasText: "Merkitty: Nordea Rahoitus Suomi Oy ei ole laina." })).toBeVisible();
    await expect(company).toHaveCount(0);
    await expect(title).toHaveCount(0);
    const { marks } = await (await context.request.get("/api/recurring")).json();
    expect(marks.map((m: { subject: string; mark: string }) => [m.subject.replace(/^(loan-proposal:out:)[^:]+:/, "$1<account>:"), m.mark])).toEqual([["loan-proposal:out:<account>:Nordea Rahoitus Suomi Oy#28900", "dismissed"]]);
    // and it holds after a reload
    await page.reload();
    await expect(card.getByRole("heading", { name: "Lainat", exact: true })).toBeVisible();
    await expect(title).toHaveCount(0);
    expect((await (await context.request.get("/api/loans/proposals")).json()).proposals).toEqual([]);
    expect(seen.problems).toEqual([]);
  } finally {
    await context.close();
    await admin.request.delete(`/api/users/${user.id}`, { headers: FETCH });
    await admin.close();
  }
});
