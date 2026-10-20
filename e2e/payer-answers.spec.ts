import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { overflow, plain, watch } from "./helpers.ts";

// Maksajat, with the rules: the member's own answers to "Mitä nämä maksut ovat?". The questions themselves are asked in
// Tarkistettavat (e2e/tr1.spec.ts); this list keeps the answers given, to change one or restore the proposal.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

test("the answers a member gave are listed with the rules: change one, restore the proposal, the row goes", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  const options = ["cost_share", "sales", "own_money", "gift", "pay"];
  // the list follows the answers the page sends, with every payer and sum made up; the server's tests hold the real list
  const answers = [
    { key: "name:ESIMERKKI VILLE", name: "Esimerkki Ville", role: "sales", options, count: 12 },
    { key: "name:ESIMERKKI FIRMA OY", name: "Esimerkki Firma Oy", role: "pay", options: options.filter((o) => o !== "own_money"), count: 3 },
  ];
  const posted: object[] = [];
  await page.route(/\/api\/payer-roles$/, async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { answers } });
    const body = route.request().postDataJSON() as { key: string; role: string | null };
    posted.push(body);
    const at = answers.findIndex((a) => a.key === body.key);
    if (body.role === null) answers.splice(at, 1);
    else answers[at]!.role = body.role;
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/#/transactions?view=merchants#saannot");
  const card = page.locator(".card").filter({ has: page.getByRole("heading", { name: "Maksajat", exact: true }) });
  await expect(card.locator(".question-row")).toHaveCount(2);
  const ville = card.locator(".question-row").filter({ hasText: "Esimerkki Ville" });
  await expect(ville.getByLabel("Mitä nämä ovat: Esimerkki Ville")).toHaveValue("sales");
  expect(plain(await ville.innerText())).toMatch(/^Esimerkki Ville 12 tapahtumaa .* Palauta ehdotus$/);
  const choices = (label: string) => card.getByLabel(label).locator("option").evaluateAll((els) => els.map((el) => el.textContent));
  expect(await choices("Mitä nämä ovat: Esimerkki Ville")).toEqual(["Yhteisten menojen osuus", "Myynti", "Omaa rahaa", "Lahja", "Palkka tai etuus"]);
  expect(await choices("Mitä nämä ovat: Esimerkki Firma Oy")).not.toContain("Omaa rahaa");

  await card.getByLabel("Mitä nämä ovat: Esimerkki Ville").selectOption("gift");
  await expect(card.getByLabel("Mitä nämä ovat: Esimerkki Ville")).toHaveValue("gift");
  await card.getByRole("button", { name: "Palauta ehdotus: Esimerkki Firma Oy" }).click();
  await expect(card.locator(".question-row")).toHaveCount(1);
  expect(posted).toEqual([
    { key: "name:ESIMERKKI VILLE", role: "gift" },
    { key: "name:ESIMERKKI FIRMA OY", role: null },
  ]);
  // the last one restored, the card is gone and the rules stay
  await card.getByRole("button", { name: "Palauta ehdotus: Esimerkki Ville" }).click();
  await expect(page.getByRole("heading", { name: "Maksajat", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Säännöt" })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  expect(seen.problems).toEqual([]);
  await context.close();
});

