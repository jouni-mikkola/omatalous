import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { unfold } from "./helpers.ts";

// Raportit > Rahankäyttö, Kategoriat: a head sorts by the keyboard, `aria-sort` follows the press and a polite sentence says the order.
// The table has no search and no chips since Rahankäyttö came (e1296aab9, #412), so the chip and search specs went with
// them; Tapahtumat still has the search and its CSV (the last spec).
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

test("Enter on the Yhteensä head sorts the categories, aria-sort changes and the new order is said", async ({ browser }) => {
  const context = await browser.newContext({
    storageState: STATE,
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  await page.goto("/#/reports?period=12m&q=menot");
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  await unfold(page, "kategoriat");
  const head = page.getByRole("columnheader", { name: /^Yhteensä/ }).first();
  await expect(head).toHaveAttribute("aria-sort", "none");
  const button = head.getByRole("button");
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(head).toHaveAttribute("aria-sort", "descending");
  await expect(page.getByRole("status").filter({ hasText: "Järjestetty: Yhteensä, suurin ensin" })).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(head).toHaveAttribute("aria-sort", "ascending");
  await page.keyboard.press("Enter");
  await expect(head).toHaveAttribute("aria-sort", "none");
  await expect(page.getByRole("status").filter({ hasText: "Alkuperäinen järjestys" })).toHaveCount(1);
  await context.close();
});

// The table of the categories: the CSV holds the rows as the table shows them, a row opens by the keyboard, and a phone has a sort choice in place of the head.
const REPORT = "/#/reports?period=12m&q=menot";
const CATEGORIES = ".rt:has(caption:text-is('Kategoriat'))";
/** The "Lataa CSV" link under the table that has this caption. */
const csvOf = (page: import("@playwright/test").Page, caption: string) => page.locator(`.rt-wrap:has(caption:text-is('${caption}')) ~ .rt-csv`).getByRole("button", { name: "Lataa CSV" });
const CATEGORY_ROWS = `${CATEGORIES} tbody tr:not(.rt-group):not(.rt-detail):not(.rt-spacer):not(.rt-subrow)`;

async function openCategories(page: import("@playwright/test").Page) {
  await page.goto(REPORT);
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  await unfold(page, "kategoriat");
  await expect(page.locator(CATEGORIES)).toBeVisible();
}

test("Lataa CSV saves the rows as the table shows them, in its order, with the figures it prints", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  await openCategories(page);
  // the file follows the order the table draws, so it is sorted first
  await page.getByRole("button", { name: /^Yhteensä/ }).first().click();
  const shown = await page.locator(CATEGORY_ROWS).evaluateAll((rows) =>
    rows.map((r) => Array.from(r.querySelectorAll("th[scope=row], td")).map((c) => (c.textContent ?? "").replace(/\s+/g, " ").trim())),
  );
  const [download] = await Promise.all([page.waitForEvent("download"), csvOf(page, "Kategoriat").click()]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  const text = await (await import("node:fs/promises")).readFile((await download.path())!, "utf8");
  const lines = text.replace(/^﻿/, "").trim().split("\r\n").map((l) => l.split(";"));
  const head = lines[0]!;
  const col = (name: string) => head.findIndex((h) => h.replace(/"/g, "") === name);
  expect(lines.length - 1, "one line per row shown").toBe(shown.length);
  // the table prints whole euros, the file has the sum as it is: within half a euro
  const num = (t: string) => (t === "–" ? 0 : Number(t.replace(/[\s  €%]/g, "").replace("−", "-").replace(",", ".")));
  const sums = (name: string, at: number) => {
    const c = col(name);
    expect(c, `${name} is a column of the file`).toBeGreaterThanOrEqual(0);
    return lines.slice(1).map((l, i) => [l[c], shown[i]![at]] as const);
  };
  const names = lines.slice(1).map((l) => l[col("Kategoria")]!.replace(/"/g, ""));
  names.forEach((name, i) => expect(shown[i]![0], "the file's order is the table's").toContain(name));
  for (const [file, printed] of sums("Yhteensä", 1)) expect(Math.abs(Number(file!.replace(",", ".")) - num(printed!)), `${printed} in the file`).toBeLessThanOrEqual(0.5);
  for (const [file, printed] of sums("Keskimäärin kuussa", 2)) expect(Math.abs(Number(file!.replace(",", ".")) - num(printed!)), `${printed} in the file`).toBeLessThanOrEqual(0.5);
  await context.close();
});

test("the keyboard opens a row, and Escape closes it and returns to it", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await openCategories(page);
  const drill = page.locator(`${CATEGORIES} .rt-drill`).first();
  await drill.focus();
  await page.keyboard.press("Enter");
  await expect(drill).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(`${CATEGORIES} tr.rt-detail`)).toHaveCount(1);
  // the opened row holds the category's months and its payees
  await expect(page.locator(`${CATEGORIES} tr.rt-detail table`)).toHaveCount(2);
  await expect(page.locator(`${CATEGORIES} tr.rt-detail table tbody tr`).first()).toBeVisible();
  await page.locator(`${CATEGORIES} tr.rt-detail a`).first().focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(`${CATEGORIES} tr.rt-detail`)).toHaveCount(0);
  await expect(drill).toBeFocused();
  await context.close();
});

test("a phone has the sort choice above the rows in place of the head", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(REPORT);
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  await unfold(page, "kategoriat");
  const pick = page.getByRole("group", { name: "Taulukon rajaus: Kategoriat" }).getByRole("button", { name: /Järjestys/ });
  await expect(pick).toBeVisible();
  await pick.click();
  await page.getByRole("option", { name: "Yhteensä, suurin ensin" }).click();
  const names = await page.locator(`${CATEGORY_ROWS} th[scope="row"]`).allInnerTexts();
  expect(names.length).toBeGreaterThan(1);
  await expect(page.getByRole("status").filter({ hasText: "Järjestetty: Yhteensä, suurin ensin" })).toHaveCount(1);
  await context.close();
});

test("Tapahtumat: the search finds a payee the list shows and the CSV has its names and amounts", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  await page.goto("/#/transactions");
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  const bar = page.getByRole("group", { name: "Taulukon rajaus: Tapahtumat" });
  await expect(bar).toBeVisible();
  const rows = page.locator(".tx-table tbody tr:not(.rt-group):not(.rt-detail):not(.rt-spacer):not(.rt-subrow)");
  const shown = await rows.count();
  expect(shown).toBeGreaterThan(1);
  const name = (await rows.first().locator(".tx-name").innerText()).trim();
  const word = name.split(/\s+/).find((w) => w.length >= 3) ?? name;
  // the search is the server's: the list is drawn in windows, so the CSV (every found row) is compared with the answer's total
  const [found] = await Promise.all([page.waitForResponse((r) => /\/api\/transactions\?.*q=/.test(r.url())), bar.getByRole("searchbox").fill(word)]);
  const total = (await found.json()).total as number;
  await expect(page.getByText("Ladataan…")).toHaveCount(0);
  await expect(rows.first()).toBeVisible();
  expect(total, "the search narrowed the list").toBeLessThan((await (await page.request.get("/api/transactions?limit=1")).json()).total);
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator(".rt-wrap:has(.tx-table) ~ .rt-csv").getByRole("button", { name: "Lataa CSV" }).click()]);
  const lines = (await (await import("node:fs/promises")).readFile((await download.path())!, "utf8")).replace(/^﻿/, "").trim().split("\r\n").slice(1);
  expect(lines.length).toBe(total);
  for (const line of lines) {
    const cells = line.split(";");
    // the day of the group comes first, since the rows have no date column of their own
    expect(cells[0], "the day").toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(cells[1], "the payee").not.toBe("");
    expect(cells[4], "the amount as a number with a decimal comma").toMatch(/^-?\d+(,\d+)?$/);
  }
  await context.close();
});
