import { expect, type Locator, test } from "@playwright/test";
import { linkFakeBank, makeMember, metaWhileSyncing, overflow, removeMember, watch } from "./helpers.ts";

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
  // until the first fetch is in, the page reloads its data every 5 s, and the reload that brings the fetched account draws
  // its row anew, closing fields opened in it: on a busy machine that came between Osuuksien mukaan and its fields
  await expect(page.getByText("Odottaa ensimmäistä hakua")).toHaveCount(0, { timeout: 30_000 });

  // the card asks about the joint account only, with "Yhteinen tili" chosen as the holders give it
  const question = page.locator("#tilien-kayttajat");
  await expect(question).toBeVisible({ timeout: 30_000 });
  await expect(question.getByRole("listitem")).toHaveCount(1);
  await expect(question.getByRole("listitem")).toContainText("Yhteistili");
  await expect(question.getByRole("listitem")).toContainText("MEIKALAINEN MATTI, KORHONEN ELISA");
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
  // who uses an account is chosen in its edit form, which is open for the choice and closed again
  const edit = (account: string) => tilit.getByRole("button", { name: `Muokkaa tiliä ${account}` }).click();
  const cancel = () => tilit.getByRole("button", { name: "Peruuta", exact: true }).click();
  await expect(use).toHaveCount(0);
  await edit("Yhteistili");
  await expect(use).toHaveValue("joint");
  await cancel();
  // the split is one control: the ways of the use and the two only an agreement says
  const parts = tilit.getByRole("group", { name: "Tilin Yhteistili jako" }).getByRole("group", { name: "Jakotapa" });
  await expect(parts.getByRole("button")).toHaveText(["Sen mukaan, kuka tilille on maksanut", "Tasan", "Osuuksien mukaan", "Tulojen suhteessa", "Kiinteä summa"]);
  await expect(parts.getByRole("button", { pressed: true })).toHaveCount(1);
  // an own account has the same select in its form, with nothing under it
  await edit("Käyttötili");
  await expect(tilit.getByRole("combobox", { name: "Tilin Käyttötili käyttäjä" })).toHaveValue(`user:${member.id}`);
  await cancel();
  await expect(tilit.getByRole("group", { name: /jako$/ })).toHaveCount(1);

  // nothing said and no payers to go by: the account is cut equally
  await expect(parts.getByRole("button", { name: "Tasan" })).toHaveAttribute("aria-pressed", "true");

  // Osuuksien mukaan: one field for each user, the last one the rest of 100 as the first is typed; Tallenna waits for a change
  await parts.getByRole("button", { name: "Osuuksien mukaan" }).click();
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
  await expect(parts.getByRole("button", { name: "Osuuksien mukaan" })).toHaveAttribute("aria-pressed", "true");
  await expect(mine).toHaveValue("70");
  await expect(hers).toHaveValue("30");
  // opening the fields of other weights and leaving them changes nothing
  // "Tasan" saves at once and the row is drawn again from what the server then says: "Osuuksien mukaan" is pressed only after that
  // (the row forgets fields opened before it), so the wait is for "Tasan" to show as pressed, not for a time
  await parts.getByRole("button", { name: "Tasan" }).click();
  await expect(parts.getByRole("button", { name: "Tasan" })).toHaveAttribute("aria-pressed", "true");
  await parts.getByRole("button", { name: "Osuuksien mukaan" }).click();
  await expect(save).toBeDisabled();

  // who paid is pressed at once, and the bank's answer comes back
  await press(parts.getByRole("button", { name: "Sen mukaan, kuka tilille on maksanut" }));
  await page.reload();
  await expect(parts.getByRole("button", { name: "Sen mukaan, kuka tilille on maksanut" })).toHaveAttribute("aria-pressed", "true");
  await parts.getByRole("button", { name: "Osuuksien mukaan" }).click();
  await mine.fill("70");
  await press(save);
  await page.reload();
  await edit("Yhteistili");
  await tilit.getByRole("button", { name: "Palauta pankin tiedoista" }).click();
  await expect(tilit.getByRole("button", { name: "Palauta pankin tiedoista" })).toHaveCount(0);
  await expect(use).toHaveValue("joint");
  await cancel();

  // another member uses the account but cannot see it: the share is offered beside it and shares nothing by itself
  // a request on an idle socket can meet its close (ECONNRESET) while the server works: ask again until it answers
  let meta: { members: { id: string; displayName: string }[] } | null = null;
  await expect.poll(async () => (meta = (await metaWhileSyncing(context)) as unknown as typeof meta)).not.toBeNull();
  const other = meta!.members.find((m) => m.id !== member.id)!;
  await edit("Yhteistili");
  await use.selectOption(`user:${other.id}`);
  await cancel();
  // the member leaves the account's pool with this change, and the split card, still drawn from the old use, asks for its
  // agreements once more: the server answers 404 for an account the member has no part of. That ask (and its console line) is expected.
  const leftPool = (p: string) => p.includes("/api/settlement/agreements/") && p.includes("404");
  const unseen = tilit.locator(".use-line").filter({ hasText: `${other.displayName} ei näe tätä tiliä, joten osuus ei näy hänen luvuissaan.` });
  await expect(unseen).toBeVisible();
  expect(((await (await context.request.get("/api/meta")).json()).shares as unknown[]).length).toBe(0);
  await unseen.getByRole("button", { name: "Jaa tili" }).click();
  await expect(unseen).toHaveCount(0);
  expect(((await (await context.request.get("/api/meta")).json()).shares as unknown[]).length).toBe(1);

  // the same share is a check box in the account's edit form (the card Tilien jakaminen is gone): clearing it takes the share back
  await expect(page.getByRole("heading", { name: "Tilien jakaminen", exact: true })).toHaveCount(0);
  await tilit.getByRole("button", { name: "Muokkaa tiliä Yhteistili" }).click();
  const shared = tilit.getByRole("group", { name: "Tilin jakaminen" }).getByRole("checkbox", { name: new RegExp(other.displayName) });
  await expect(shared).toBeChecked();
  await shared.uncheck();
  await expect.poll(async () => ((await (await context.request.get("/api/meta")).json()).shares as unknown[]).length).toBe(0);
  await shared.check();
  // each check box stands beside its text, not above it, at the phone and the desktop width
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const beside = await shared.evaluate((box) => {
      const label = box.closest("label")!;
      const text = document.createRange();
      text.selectNodeContents(label);
      const first = [...text.getClientRects()].find((r) => r.width > 0 && r.left >= box.getBoundingClientRect().right - 1);
      const b = box.getBoundingClientRect();
      return first !== undefined && first.top < b.bottom && first.bottom > b.top;
    });
    expect(beside, `check box beside its text at ${width} px`).toBe(true);
  }
  await expect.poll(async () => ((await (await context.request.get("/api/meta")).json()).shares as unknown[]).length).toBe(1);
  await tilit.getByRole("button", { name: "Peruuta", exact: true }).click();

  // a window narrower than four columns need: the table stays inside its card with the balance and the edit button both in view
  for (const width of [640, 700]) {
    await page.setViewportSize({ width, height: 900 });
    const card = tilit.locator(".rt-wrap");
    expect(await card.evaluate((el) => el.scrollWidth - el.clientWidth), `Tilit at ${width} px scrolls sideways in its card`).toBeLessThanOrEqual(1);
    const button = tilit.getByRole("button", { name: "Muokkaa tiliä Yhteistili" });
    await button.scrollIntoViewIfNeeded(); // the window's bottom may cut it; the check is about the sides
    await expect(button).toBeInViewport({ ratio: 1 });
  }

  // a phone: the select of the form sits inside the page, and nothing scrolls sideways
  await page.setViewportSize({ width: 390, height: 844 });
  await edit("Yhteistili");
  await use.selectOption("joint");
  await expect(use).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  expect(seen.problems.filter((p) => !leftPool(p))).toEqual([]);
  await context.close();
});
