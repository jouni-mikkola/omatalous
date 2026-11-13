import { expect, type Locator, type Page, test } from "@playwright/test";
import { join } from "node:path";
import { watch } from "./helpers.ts";

// Closing a dialog by Escape or by Peruuta puts the focus back on the button that opened it. One test per kind of
// dialog: the question (ConfirmDialog), the loan form, the panel of a figure's rows (Why) and the password form.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const FETCH = { "X-Requested-With": "fetch" };

/** Opens with the button, closes with each way in turn, and asks where the focus is each time. */
async function returns(page: Page, opener: Locator, cancel: string): Promise<void> {
  for (const how of ["Escape", "Peruuta"] as const) {
    await opener.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    if (how === "Escape") await page.keyboard.press("Escape");
    else await dialog.getByRole("button", { name: cancel, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(opener, `closed with ${how}`).toBeFocused();
  }
}

test("the question about a loan and its form hand the focus back to the button that opened them", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const today = (await (await context.request.get("/api/meta")).json()).today as string;
  const saved = await context.request.post("/api/loans", {
    headers: FETCH,
    data: {
      name: "Dialogilaina", lender: "Esimerkkirahoitus Oy", kind: "mortgage", grantedCents: 15_000_000, balanceCents: 12_000_000, balanceDate: today,
      rateBp: 400, reference: "euribor_12", marginBp: 60, repayment: "annuity", intervalMonths: 1, paymentCents: 100_000, endDate: null, limitCents: null, seriesKey: null,
    },
  });
  expect(saved.status()).toBe(200);
  const id = (await saved.json()).loan?.id ?? (await saved.json()).id;
  const page = await context.newPage();
  const seen = watch(page);
  try {
    await page.goto("/#/settings/household");
    const card = page.locator("#lainat");
    await returns(page, card.getByRole("button", { name: "Poista laina Dialogilaina" }), "Peruuta");
    await returns(page, card.getByRole("button", { name: "Muokkaa lainaa Dialogilaina" }), "Peruuta");
    expect(seen.problems).toEqual([]);
  } finally {
    if (id) await context.request.delete(`/api/loans/${id}`, { headers: FETCH });
    await context.close();
  }
});

test("the panel of a figure's rows hands the focus back", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  // the doors to a figure's rows are on Kuukausi: Rahankäyttö opens a category in place
  await page.goto("/#/reports");
  await expect(page.locator(".km .km-total")).toContainText(/Menot\s[\d\s]+€/, { timeout: 15_000 });
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  const opener = page.getByRole("button", { name: /^Näytä tapahtumat: / }).first();
  await opener.click();
  const panel = page.getByRole("dialog");
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("the password form of a maintenance act hands the focus back", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/settings/server#yllapito");
  // the danger zone is folded until it is opened
  await page.getByRole("heading", { name: "Tyhjennä kaikki tiedot" }).click();
  const opener = page.getByRole("button", { name: "Tyhjennä kaikki tiedot" });
  await expect(opener).toBeVisible();
  await returns(page, opener, "Peruuta");
  expect(seen.problems).toEqual([]);
  await context.close();
});
