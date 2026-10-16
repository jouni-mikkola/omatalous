import { expect, type Locator, test } from "@playwright/test";
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

  // saved as shown: the row has "Yhteinen tili" and the three ways to cut it, of which one is pressed
  const tilit = page.locator("#tilit");
  const use = tilit.getByRole("combobox", { name: "Tilin Yhteistili käyttäjä" });
  await expect(use).toHaveValue("joint");
  const parts = tilit.getByRole("group", { name: "Tilin Yhteistili osuudet" });
  await expect(parts.getByRole("button")).toHaveText(["Sen mukaan, kuka tilille on maksanut", "Tasan", "Prosentit"]);
  await expect(parts.getByRole("button", { pressed: true })).toHaveCount(1);
  // an own account has the same select, with nothing under it
  await expect(tilit.getByRole("combobox", { name: "Tilin Käyttötili käyttäjä" })).toHaveValue(`user:${member.id}`);
  await expect(tilit.getByRole("group", { name: /osuudet$/ })).toHaveCount(1);

  // nothing said and no payers to go by: the account is cut equally
  await expect(parts.getByRole("button", { name: "Tasan" })).toHaveAttribute("aria-pressed", "true");

  // Prosentit: one field for each user, the last one the rest of 100 as the first is typed; Tallenna waits for a change
  await parts.getByRole("button", { name: "Prosentit" }).click();
  const [mine, hers] = [tilit.getByLabel(`${USERNAME} %`), tilit.getByLabel("KORHONEN ELISA %")];
  const save = tilit.getByRole("button", { name: "Tallenna", exact: true });
  // a press that saves: waits for the answer of the server, so a reload does not cut the request
  const press = async (button: Locator) => {
    const done = page.waitForResponse((r) => r.request().method() !== "GET" && r.url().includes("/api/accounts/"));
    await button.click();
    await done;
  };
  await expect(mine).toHaveValue("50");
  await expect(save).toBeDisabled();
  await mine.fill("70,5");
  await expect(hers).toHaveValue("29,5");
  await expect(save).toBeEnabled();
  // 101 and a letter are refused before a request is made: Tallenna stays off
  for (const text of ["101", "x"]) {
    await mine.fill(text);
    await expect(mine).toHaveAttribute("aria-invalid", "true");
    await expect(save).toBeDisabled();
  }
  await mine.fill("70");
  await expect(hers).toHaveValue("30");
  await press(save);
  await page.reload();
  await expect(parts.getByRole("button", { name: "Prosentit" })).toHaveAttribute("aria-pressed", "true");
  await expect(mine).toHaveValue("70");
  await expect(hers).toHaveValue("30");
  // opening the fields of other weights and leaving them changes nothing
  // "Tasan" saves at once and the row is drawn again from what the server then says: "Prosentit" is pressed only after that
  // (the row forgets fields opened before it), so the wait is for "Tasan" to show as pressed, not for a time
  await parts.getByRole("button", { name: "Tasan" }).click();
  await expect(parts.getByRole("button", { name: "Tasan" })).toHaveAttribute("aria-pressed", "true");
  await parts.getByRole("button", { name: "Prosentit" }).click();
  await expect(save).toBeDisabled();

  // who paid is pressed at once, and the bank's answer comes back
  await press(parts.getByRole("button", { name: "Sen mukaan, kuka tilille on maksanut" }));
  await page.reload();
  await expect(parts.getByRole("button", { name: "Sen mukaan, kuka tilille on maksanut" })).toHaveAttribute("aria-pressed", "true");
  await parts.getByRole("button", { name: "Prosentit" }).click();
  await mine.fill("70");
  await press(save);
  await page.reload();
  await tilit.getByRole("button", { name: "Palauta pankin tiedoista" }).click();
  await expect(tilit.getByRole("button", { name: "Palauta pankin tiedoista" })).toHaveCount(0);
  await expect(use).toHaveValue("joint");

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

  // a window narrower than five columns need: the type and the user sit under the name, and the table stays inside its card
  // with the balance and the edit button both in view
  for (const width of [640, 700]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(use).toBeVisible();
    const card = tilit.locator(".table-wrap");
    expect(await card.evaluate((el) => el.scrollWidth - el.clientWidth), `Tilit at ${width} px scrolls sideways in its card`).toBeLessThanOrEqual(1);
    const edit = tilit.getByRole("button", { name: "Muokkaa tiliä Yhteistili" });
    await edit.scrollIntoViewIfNeeded(); // the window's bottom may cut it; the check is about the sides
    await expect(edit).toBeInViewport({ ratio: 1 });
  }

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
