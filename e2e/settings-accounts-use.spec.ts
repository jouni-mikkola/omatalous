import { expect, test } from "@playwright/test";
import { linkFakeBank, makeMember, overflow, removeMember, watch } from "./helpers.ts";

// Asetukset > Tilit says who uses an account: the question after a link, the choice in a row, the parts of a joint account
// and the share for a member who cannot see it. The accounts are those of a member made here, linked from the fake bank
// (e2e/fake-bank/): MEIKALAINEN MATTI;KORHONEN ELISA hold the joint account, and the second holder is no member.
const USERNAME = "e2e-kayttajat";

let member: { state: string; id: string };
test.beforeAll(async ({ browser }) => {
  member = await makeMember(browser, USERNAME);
});
test.afterAll(async ({ browser }) => removeMember(browser, member.id));

test("the question after a link, the parts of the joint account, the bank's answer back, and a member who cannot see the account", async ({ browser }) => {
  const context = await browser.newContext({ storageState: member.state, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await linkFakeBank(page);

  // the card asks about the joint account only, with "Yhteinen tili" chosen as the holders give it
  const question = page.locator("#tilien-kayttajat");
  await expect(question).toBeVisible({ timeout: 30_000 });
  await expect(question.getByRole("row")).toHaveCount(1);
  await expect(question.getByRole("row")).toContainText("Yhteistili");
  await expect(question.getByRole("row")).toContainText("MEIKALAINEN MATTI, KORHONEN ELISA");
  await expect(question.getByRole("combobox", { name: "Tilin Yhteistili käyttäjä" })).toHaveValue("joint");
  // a phone: the card is as wide as the page
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await question.getByRole("button", { name: "Tallenna", exact: true }).click();
  await expect(question).toHaveCount(0);

  // saved as shown: the row has "Yhteinen tili" and "Tasan"
  const tilit = page.locator("#tilit");
  const use = tilit.getByRole("combobox", { name: "Tilin Yhteistili käyttäjä" });
  await expect(use).toHaveValue("joint");
  const parts = tilit.getByRole("group", { name: "Tilin Yhteistili osuudet" });
  await expect(parts.getByRole("button", { name: "Tasan" })).toHaveAttribute("aria-pressed", "true");
  await expect(parts.getByRole("button", { name: "Omat osuudet" })).toHaveAttribute("aria-pressed", "false");
  // an own account has the same select, with nothing under it
  await expect(tilit.getByRole("combobox", { name: "Tilin Käyttötili käyttäjä" })).toHaveValue(`user:${member.id}`);
  await expect(tilit.getByRole("group")).toHaveCount(1);

  // the bank's rows propose the parts: 600 and 400 euros a month
  const proposal = tilit.locator(".use-line").filter({ hasText: "on maksanut tilille keskimäärin" });
  await expect(proposal).toContainText(/600\s€ ja KORHONEN ELISA 400\s€ kuussa/);

  // typing the euros shows what they come to, and a reload keeps them
  await parts.getByRole("button", { name: "Omat osuudet" }).click();
  await tilit.getByLabel(`${USERNAME} € kuussa`).fill("600");
  await tilit.getByLabel("KORHONEN ELISA € kuussa").fill("400");
  await expect(tilit.locator(".use-total")).toHaveText("60 % ja 40 %");
  await tilit.getByRole("button", { name: "Tallenna", exact: true }).click();
  await expect(tilit.getByRole("status").filter({ hasText: "Tallennettu." })).toBeVisible();
  await page.reload();
  await expect(tilit.getByLabel(`${USERNAME} € kuussa`)).toHaveValue("600");
  await expect(tilit.getByLabel("KORHONEN ELISA € kuussa")).toHaveValue("400");
  await expect(tilit.locator(".use-total")).toHaveText("60 % ja 40 %");
  // the proposal is taken: it is not offered again
  await expect(proposal).toHaveCount(0);

  // nothing above zero is refused before a request is made
  await tilit.getByLabel(`${USERNAME} € kuussa`).fill("0");
  await tilit.getByLabel("KORHONEN ELISA € kuussa").fill("");
  await tilit.getByRole("button", { name: "Tallenna", exact: true }).click();
  await expect(tilit.getByText("Ainakin yhdellä käyttäjällä pitää olla osuus.")).toBeVisible();

  // the bank's answer comes back
  await page.reload();
  await tilit.getByRole("button", { name: "Palauta pankin tiedoista" }).click();
  await expect(tilit.getByRole("button", { name: "Palauta pankin tiedoista" })).toHaveCount(0);
  await expect(parts.getByRole("button", { name: "Tasan" })).toHaveAttribute("aria-pressed", "true");
  await expect(use).toHaveValue("joint");

  // the proposal is one press
  await proposal.getByRole("button", { name: "Käytä näitä" }).click();
  await expect(proposal).toHaveCount(0);
  await expect(parts.getByRole("button", { name: "Omat osuudet" })).toHaveAttribute("aria-pressed", "true");
  await expect(tilit.getByLabel("KORHONEN ELISA € kuussa")).toHaveValue("400");

  // another member uses the account but cannot see it: the share is offered beside it and shares nothing by itself
  const meta = await (await context.request.get("/api/meta")).json();
  const other = (meta.members as { id: string; displayName: string }[]).find((m) => m.id !== member.id)!;
  await use.selectOption(`user:${other.id}`);
  const unseen = tilit.locator(".use-line").filter({ hasText: `${other.displayName} ei näe tätä tiliä, joten osuus ei näy hänen luvuissaan.` });
  await expect(unseen).toBeVisible();
  expect(((await (await context.request.get("/api/meta")).json()).shares as unknown[]).length).toBe(0);
  await unseen.getByRole("button", { name: "Jaa tili" }).click();
  await expect(unseen).toHaveCount(0);
  expect(((await (await context.request.get("/api/meta")).json()).shares as unknown[]).length).toBe(1);

  // a phone: the select sits under the name, and nothing scrolls sideways
  await use.selectOption("joint");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(use).toBeVisible();
  const name = tilit.getByRole("row", { name: /^Yhteistili / }).first();
  const [nameBox, useBox] = [await name.locator("td").first().boundingBox(), await use.boundingBox()];
  expect(useBox!.y).toBeGreaterThan(nameBox!.y);
  expect(useBox!.x).toBeLessThan(nameBox!.x + nameBox!.width);
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  expect(seen.problems).toEqual([]);
  await context.close();
});
